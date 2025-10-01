from fastapi import FastAPI, Request, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
import time, uuid, logging

from core.config import settings, safe_settings_snapshot
from core.firebase import init_firebase
from core.logging import setup_logging
from core import redis_utils

from routers import health
from features.auth import routes as auth_routes  # type: ignore
from features.profile import routes as profile_routes  # type: ignore
from features.rag.router import router as rag_router
from features.rag.contracts_router import router as rag_contracts_router
from features.files.router import router as files_router  # type: ignore

log = logging.getLogger("app")

class ObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        t0 = time.time()
        trace_id = request.headers.get("x-trace-id") or str(uuid.uuid4())
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        tenant = request.headers.get("x-tenant-id")

        request.state.trace_id = trace_id
        request.state.request_id = request_id
        request.state.tenant_id = tenant

        log.info(
            "http_request",
            method=request.method,
            path=request.url.path,
            query=str(request.url.query),
            client=str(request.client),
            trace_id=trace_id,
            request_id=request_id,
            tenant_id=tenant,
        )
        try:
            resp: Response = await call_next(request)
            dur_ms = int((time.time() - t0) * 1000)
            resp.headers["X-Trace-Id"] = trace_id
            resp.headers["X-Request-Id"] = request_id
            log.info(
                "http_response",
                method=request.method,
                path=request.url.path,
                status=resp.status_code,
                dur_ms=dur_ms,
                trace_id=trace_id,
                request_id=request_id,
                tenant_id=tenant,
            )
            return resp
        except Exception:
            dur_ms = int((time.time() - t0) * 1000)
            log.exception(
                "http_error",
                method=request.method,
                path=request.url.path,
                dur_ms=dur_ms,
                trace_id=trace_id,
                request_id=request_id,
                tenant_id=tenant,
            )
            raise

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Boot
    setup_logging()
    log.info("app_boot", **safe_settings_snapshot())
    init_firebase()
    # Connect Redis
    await redis_utils.init(settings.REDIS_URL)
    yield
    # Shutdown
    await redis_utils.close()

def create_app() -> FastAPI:
    app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

    if settings.TRUSTED_HOSTS and settings.TRUSTED_HOSTS != ["*"]:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.TRUSTED_HOSTS)

    app.add_middleware(ObservabilityMiddleware)

    if settings.CORS_ALLOW_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.CORS_ALLOW_ORIGINS,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["X-Trace-Id","X-Request-Id"],
        )

    # Routers
    app.include_router(health.router)
    app.include_router(auth_routes.router)
    app.include_router(profile_routes.router)
    app.include_router(rag_router)
    app.include_router(rag_contracts_router)
    app.include_router(files_router)

    # Versioned mirrors
    app.include_router(auth_routes.router, prefix="/v1")
    app.include_router(profile_routes.router, prefix="/v1")
    app.include_router(rag_router, prefix="/v1")

    return app

app = create_app()

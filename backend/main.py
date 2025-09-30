from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import time, uuid, logging

from core.config import settings, safe_settings_snapshot
from core.firebase import init_firebase
from core.logging import setup_logging

from routers import health
from features.auth import routes as auth_routes  # type: ignore
from features.profile import routes as profile_routes  # type: ignore

# RAG MVP router (ingest/query under /features/rag/*)
from features.rag.router import router as rag_router
# RAG Contracts router (already exposes /v1/search and /v1/chat)
from features.rag.contracts_router import router as rag_contracts_router
from features.files.router import router as files_router  # type: ignore

log = logging.getLogger("app")

class ObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        t0 = time.time()
        # Correlate
        trace_id = request.headers.get("x-trace-id") or str(uuid.uuid4())
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        tenant = request.headers.get("x-tenant-id")

        # Attach to state for handlers
        request.state.trace_id = trace_id
        request.state.request_id = request_id
        request.state.tenant_id = tenant

        # Log request start (without body to avoid PII)
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
            # Add correlation headers for the client
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
        except Exception as e:
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

def create_app() -> FastAPI:
    setup_logging()
    # Log a sanitized snapshot of relevant settings at boot
    log.info("app_boot", **safe_settings_snapshot())

    # Initialize Firebase Admin once (skips in tests per core/firebase.py)
    init_firebase()

    app = FastAPI(title=settings.APP_NAME)

    # Trusted hosts (tighten in prod)
    if settings.TRUSTED_HOSTS and settings.TRUSTED_HOSTS != ["*"]:
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=settings.TRUSTED_HOSTS,
        )

    # Global request/response observability
    app.add_middleware(ObservabilityMiddleware)

    # CORS
    if settings.CORS_ALLOW_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.CORS_ALLOW_ORIGINS,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["X-Trace-Id","X-Request-Id"],
        )

    # ---- Routers ----
    app.include_router(health.router)
    app.include_router(auth_routes.router)
    app.include_router(profile_routes.router)
    app.include_router(rag_router)               # /features/rag/ingest, /features/rag/query
    app.include_router(rag_contracts_router)     # /v1/search, /v1/chat (contracts)
    app.include_router(files_router)

    # ---- Versioned mirrors ----
    app.include_router(auth_routes.router, prefix="/v1")
    app.include_router(profile_routes.router, prefix="/v1")
    app.include_router(rag_router, prefix="/v1")

    return app

app = create_app()

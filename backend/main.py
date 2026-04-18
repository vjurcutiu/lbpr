
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
import time, uuid, logging

from core.config import settings, safe_settings_snapshot
from core.firebase import init_firebase
from core.logging import setup_logging
from core import redis_utils
from core.request_context import set_request_context, reset_request_context
from core.telemetry import current_trace_id_hex, setup_telemetry, shutdown_telemetry

from routers import health
from routers.limits import router as limits_router
from features.auth import routes as auth_routes  # type: ignore
from features.profile import routes as profile_routes  # type: ignore
from features.chat_history.router import router as chat_history_router
from features.rag.router import router as rag_router
from features.rag.contracts_router import router as rag_contracts_router
from features.files.router import router as files_router  # type: ignore
# NEW
from features.upload_tracker.router import router as upload_tracker_router  # type: ignore
from features.transcription.router import router as transcription_router  # type: ignore
from features.ocr.router import router as ocr_router  # type: ignore
from features.workflows.router import router as workflows_router  # type: ignore

log = logging.getLogger("app")

class ObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip noisy probes
        if request.url.path in ("/healthz", "/v1/healthz"):
            return await call_next(request)

        t0 = time.time()
        trace_id = request.headers.get("x-trace-id") or current_trace_id_hex() or str(uuid.uuid4())
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        tenant = request.headers.get("x-tenant-id")

        request.state.trace_id = trace_id
        request.state.request_id = request_id
        request.state.tenant_id = tenant

        ctx_tokens = set_request_context(trace_id=trace_id, request_id=request_id, tenant_id=tenant)

        # These endpoints are frequently polled by the SPA and can spam logs.
        noisy_paths = {"/session", "/auth/session", "/v1/files", "/v1/files/folders"}

        # Request logs are DEBUG by default (enable with LOG_LEVEL=DEBUG)
        log.debug(
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

            # Reduce noise: successful fast GETs (and common pollers) are DEBUG; keep slow/errors at INFO/WARN.
            if resp.status_code >= 500:
                log.error(
                    "http_response",
                    method=request.method,
                    path=request.url.path,
                    status=resp.status_code,
                    dur_ms=dur_ms,
                    trace_id=trace_id,
                    request_id=request_id,
                    tenant_id=tenant,
                )
            elif resp.status_code >= 400:
                log.warning(
                    "http_response",
                    method=request.method,
                    path=request.url.path,
                    status=resp.status_code,
                    dur_ms=dur_ms,
                    trace_id=trace_id,
                    request_id=request_id,
                    tenant_id=tenant,
                )
            elif dur_ms >= 1500:
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
            elif request.url.path in noisy_paths or request.method == "GET":
                log.debug(
                    "http_response",
                    method=request.method,
                    path=request.url.path,
                    status=resp.status_code,
                    dur_ms=dur_ms,
                    trace_id=trace_id,
                    request_id=request_id,
                    tenant_id=tenant,
                )
            else:
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
        finally:
            reset_request_context(ctx_tokens)

@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    log.info("app_boot", **safe_settings_snapshot())
    init_firebase()
    await redis_utils.init(settings.REDIS_URL)
    yield
    await redis_utils.close()
    shutdown_telemetry()

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
    app.include_router(limits_router)
    app.include_router(auth_routes.router)
    app.include_router(profile_routes.router)
    app.include_router(chat_history_router)
    app.include_router(rag_router)
    app.include_router(rag_contracts_router)
    app.include_router(files_router)
    # NEW
    app.include_router(upload_tracker_router)
    app.include_router(transcription_router)
    app.include_router(ocr_router)
    app.include_router(workflows_router)

    # Versioned mirrors
    app.include_router(auth_routes.router, prefix="/v1")
    app.include_router(profile_routes.router, prefix="/v1")
    app.include_router(rag_router, prefix="/v1")

    setup_telemetry(app)

    return app

app = create_app()

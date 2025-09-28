# C:/code2/lbpr/backend/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from core.config import settings
from core.firebase import init_firebase

from routers import health
from features.auth import routes as auth_routes
from features.profile import routes as profile_routes

# RAG MVP router (ingest/query under /features/rag/*)
from features.rag.router import router as rag_router
# RAG Contracts router (already exposes /v1/search and /v1/chat)
from features.rag.contracts_router import router as rag_contracts_router


def create_app() -> FastAPI:
    # Initialize Firebase Admin once (skips in tests per core/firebase.py)
    init_firebase()

    app = FastAPI(title=settings.APP_NAME)

    # Trusted hosts (tighten in prod)
    if settings.TRUSTED_HOSTS and settings.TRUSTED_HOSTS != ["*"]:
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=settings.TRUSTED_HOSTS,
        )

    # CORS
    if settings.CORS_ALLOW_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.CORS_ALLOW_ORIGINS,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # ---- Routers ----
    app.include_router(health.router)
    app.include_router(auth_routes.router)
    app.include_router(profile_routes.router)
    app.include_router(rag_router)               # /features/rag/ingest, /features/rag/query
    app.include_router(rag_contracts_router)     # /v1/search, /v1/chat (contracts)

    # ---- Versioned mirrors ----
    # Keep mirrors for non-contract routers
    app.include_router(auth_routes.router, prefix="/v1")
    app.include_router(profile_routes.router, prefix="/v1")
    app.include_router(rag_router, prefix="/v1")

    return app


app = create_app()

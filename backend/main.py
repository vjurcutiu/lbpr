from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from core.config import settings
from core.firebase import init_firebase
from routers import health
from features.auth import routes as auth_routes
from features.profile import routes as profile_routes  # <-- NEW

def create_app() -> FastAPI:
    init_firebase()  # safe to call once; lazy guarded
    app = FastAPI(title=settings.APP_NAME)

    if settings.TRUSTED_HOSTS and settings.TRUSTED_HOSTS != ["*"]:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.TRUSTED_HOSTS)

    if settings.CORS_ALLOW_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.CORS_ALLOW_ORIGINS,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # Routers
    app.include_router(health.router)
    app.include_router(auth_routes.router)
    app.include_router(profile_routes.router)          # <-- NEW: /me (GET/PATCH)

    # Versioned mirrors
    app.include_router(auth_routes.router, prefix="/v1")
    app.include_router(profile_routes.router, prefix="/v1")  # <-- NEW

    return app

app = create_app()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from core.config import settings
from core.firebase import init_firebase
from routers import health
from features.auth import routes as auth_routes

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

    app.include_router(health.router)
    app.include_router(auth_routes.router)
    app.include_router(auth_routes.router, prefix="/v1")  # versioned mirror

    return app

app = create_app()

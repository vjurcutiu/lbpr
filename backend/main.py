from fastapi import FastAPI
from core.config import settings
from core.firebase import init_firebase
from features.rag.router import router as rag_router
from features.rag.contracts_router import router as rag_contracts_router

def create_app() -> FastAPI:
    init_firebase()
    app = FastAPI(title=settings.APP_NAME)
    app.include_router(rag_router)
    app.include_router(rag_contracts_router)
    app.include_router(rag_router, prefix="/v1")
    return app

app = create_app()

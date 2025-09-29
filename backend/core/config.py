
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Literal

class Settings(BaseSettings):
    APP_NAME: str = "LexBot Pro"
    ENV: Literal["dev", "staging", "prod"] = "dev"

    # Firebase
    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_CREDENTIALS: str | None = None
    FIREBASE_CREDENTIALS_DEFAULT: str | None = "/run/secrets/firebase_sa.json"
    FIREBASE_STORAGE_BUCKET: str | None = None  # used by Files feature

    # Auth / cookies
    COOKIE_NAME: str = "fb_session"
    SESSION_HOURS: int = 8
    COOKIE_SECURE: bool = Field(default=False, description="True in prod (HTTPS)")
    COOKIE_SAMESITE: Literal["lax", "none", "strict"] = "lax"
    COOKIE_PATH: str = "/"
    COOKIE_DOMAIN: str | None = None  # set your domain in prod if needed

    # CORS / Hosts (tune per deployment)
    CORS_ALLOW_ORIGINS: list[str] = []
    TRUSTED_HOSTS: list[str] = ["*"]  # lock down in prod

    # ── RAG / Embeddings / Vector store (aligns with .env) ─────────────────
    RAG_EMBEDDER: Literal["local", "openai"] = "local"
    OPENAI_API_KEY: str | None = None
    RAG_EMBED_MODEL: str = "text-embedding-3-small"

    RAG_VECTORSTORE: Literal["memory", "pinecone"] = "memory"
    PINECONE_API_KEY: str | None = None
    PINECONE_INDEX: str | None = None
    PINECONE_CLOUD: str | None = None
    PINECONE_REGION: str | None = None

    # Optional override when creating Pinecone index (dimension inference otherwise)
    RAG_EMBED_DIM: int | None = None

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()

def safe_settings_snapshot() -> dict:
    # Only include non-sensitive, decision-making fields for boot logs
    return {
        "env": settings.ENV,
        "firebase_project_id": settings.FIREBASE_PROJECT_ID,
        "firebase_bucket": settings.FIREBASE_STORAGE_BUCKET,
        "rag_embedder": settings.RAG_EMBEDDER,
        "rag_model": settings.RAG_EMBED_MODEL,
        "rag_vectorstore": settings.RAG_VECTORSTORE,
        "pinecone_index": settings.PINECONE_INDEX,
        "pinecone_cloud": settings.PINECONE_CLOUD,
        "pinecone_region": settings.PINECONE_REGION,
        "rag_embed_dim": settings.RAG_EMBED_DIM,
    }

from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """Application configuration loaded from environment and .env.

    Uses Pydantic v2 Settings with explicit model_config to avoid
    'extra_forbidden' errors and to read keys case-insensitively.
    """

    # pydantic-settings v2 style config
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,   # allow APP_NAME / app_name, etc.
        extra="ignore",         # ignore unknown vars instead of raising
    )

    # General
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

    # CORS / Hosts
    CORS_ALLOW_ORIGINS: list[str] = []
    TRUSTED_HOSTS: list[str] = ["*"]  # lock down in prod

    # ── RAG / Embeddings / Vector store ─────────────────────────────────
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

    # Hybrid search tuning (accept values provided in .env)
    RAG_HYBRID_FUSION: Literal["rrf", "alpha"] = "rrf"
    RAG_HYBRID_ALPHA: float = 0.5

# Instantiate settings at import time (FastAPI typical pattern)
settings = Settings()

def safe_settings_snapshot() -> dict:
    """Return a sanitized subset of settings for startup logs."""
    return {
        "env": settings.ENV,
        "firebase_project_id": settings.FIREBASE_PROJECT_ID,
        "firebase_bucket": settings.FIREBASE_STORAGE_BUCKET
            or f"{settings.FIREBASE_PROJECT_ID}.appspot.com",
        "rag_embedder": settings.RAG_EMBEDDER,
        "rag_model": settings.RAG_EMBED_MODEL,
        "rag_vectorstore": settings.RAG_VECTORSTORE,
        "pinecone_index": settings.PINECONE_INDEX,
        "pinecone_cloud": settings.PINECONE_CLOUD,
        "pinecone_region": settings.PINECONE_REGION,
        "rag_embed_dim": settings.RAG_EMBED_DIM,
        "rag_hybrid_fusion": settings.RAG_HYBRID_FUSION,
        "rag_hybrid_alpha": settings.RAG_HYBRID_ALPHA,
    }

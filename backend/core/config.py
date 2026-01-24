from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """Application configuration loaded from environment and .env."""
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # General
    APP_NAME: str = "LexBot Pro"
    ENV: Literal["dev", "staging", "prod"] = "dev"

    # Firebase
    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_CREDENTIALS: str | None = None
    FIREBASE_CREDENTIALS_DEFAULT: str | None = "/run/secrets/firebase_sa.json"
    FIREBASE_STORAGE_BUCKET: str | None = None

    # Auth / cookies
    COOKIE_NAME: str = "fb_session"
    SESSION_HOURS: int = 8
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: Literal["lax", "none", "strict"] = "lax"
    COOKIE_PATH: str = "/"
    COOKIE_DOMAIN: str | None = None

    # CORS / Hosts
    CORS_ALLOW_ORIGINS: list[str] = []
    TRUSTED_HOSTS: list[str] = ["*"]

    # RAG / Vector store
    RAG_EMBEDDER: Literal["local", "openai"] = "local"
    OPENAI_API_KEY: str | None = None
    RAG_EMBED_MODEL: str = "text-embedding-3-small"

    RAG_VECTORSTORE: Literal["memory", "pinecone"] = "memory"
    PINECONE_API_KEY: str | None = None
    PINECONE_INDEX: str | None = None
    PINECONE_CLOUD: str | None = None
    PINECONE_REGION: str | None = None
    RAG_EMBED_DIM: int | None = None

    # Hybrid search tuning
    RAG_HYBRID_FUSION: Literal["rrf", "alpha"] = "rrf"
    RAG_HYBRID_ALPHA: float = 0.5

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # -------- Plans / Limits (monthly window, per-user) --------
    # Default "FREE" limits
    LIMITS_FREE_MESSAGES: int = 200              # number of chat messages per calendar month
    LIMITS_FREE_UPLOAD_TOKENS: int = 200_000     # tokens accepted by /ingest & file uploads per month

    # Default "PRO" limits
    LIMITS_PRO_MESSAGES: int = 10000
    LIMITS_PRO_UPLOAD_TOKENS: int = 20_000_000

    # Optional override: count upload tokens using this tokenizer/model id.
    TOKENIZER_MODEL: str | None = None  # if None, auto-pick based on RAG_EMBED_MODEL

    RAG_HYBRID_DUAL_INDEX: bool = False
    PINECONE_INDEX_DENSE: str | None = None
    PINECONE_INDEX_SPARSE: str | None = None

    # -------- PII Pseudonymization (Google Sensitive Data Protection/DLP + Cloud KMS) --------
    # Off by default so dev/test can run without Google Cloud credentials.
    PII_ENABLED: bool = False

    # DLP project/location. If empty, falls back to FIREBASE_PROJECT_ID.
    PII_DLP_PROJECT_ID: str | None = None
    PII_DLP_LOCATION: str = "global"

    # Comma-separated DLP infoTypes to detect (examples: EMAIL_ADDRESS, PHONE_NUMBER).
    # NOTE: Some detectors (PERSON_NAME, LOCATION, STREET_ADDRESS, etc.) can add latency.
    PII_DLP_INFOTYPES: str = "EMAIL_ADDRESS,PHONE_NUMBER"

    # Min likelihood: VERY_UNLIKELY|UNLIKELY|POSSIBLE|LIKELY|VERY_LIKELY
    PII_DLP_MIN_LIKELIHOOD: str = "LIKELY"

    # Full KMS cryptoKey resource name:
    # projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>
    PII_KMS_KEY_NAME: str | None = None

    # Tokenize file/folder names & upload-tracker filenames as well as document text.
    PII_TOKENIZE_FILENAMES: bool = True

settings = Settings()

def safe_settings_snapshot() -> dict:
    return {
        "env": settings.ENV,
        "firebase_project_id": settings.FIREBASE_PROJECT_ID,
        "firebase_bucket": settings.FIREBASE_STORAGE_BUCKET
            or (f"{settings.FIREBASE_PROJECT_ID}.appspot.com" if settings.FIREBASE_PROJECT_ID else None),
        "rag_embedder": settings.RAG_EMBEDDER,
        "rag_model": settings.RAG_EMBED_MODEL,
        "rag_vectorstore": settings.RAG_VECTORSTORE,
        "pinecone_index": settings.PINECONE_INDEX,
        "pinecone_cloud": settings.PINECONE_CLOUD,
        "pinecone_region": settings.PINECONE_REGION,
        "rag_embed_dim": settings.RAG_EMBED_DIM,

    }

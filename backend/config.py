from typing import Optional
from dotenv import load_dotenv
from pathlib import Path
import os

# Always load .env from the backend directory regardless of where uvicorn is launched from
_env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=_env_path, override=False)


def _get_env(name: str, default=None):
    value = os.environ.get(name)
    if value is not None:
        return value
    return default


class Settings:
    database_url: str = _get_env("DATABASE_URL", "sqlite:///./bar_restaurant.db")
    mongodb_uri: str = _get_env("MONGODB_URI", "mongodb://localhost:27017")
    mongodb_database: str = _get_env("MONGODB_DATABASE", "bar_restaurant")
    jwt_secret: str = _get_env("JWT_SECRET", "")
    admin_email: str = _get_env("ADMIN_EMAIL", "owner@barrestaurant.com")
    admin_password: str = _get_env("ADMIN_PASSWORD", "owner123")
    frontend_url: str = _get_env("FRONTEND_URL", "http://localhost:3000")
    emergent_llm_key: Optional[str] = _get_env("EMERGENT_LLM_KEY", None)
    storage_url: str = _get_env(
        "STORAGE_URL",
        "https://integrations.emergentagent.com/objstore/api/v1/storage"
    )
    app_name: str = _get_env("APP_NAME", "bar-restaurant-mgmt")
    jwt_algorithm: str = _get_env("JWT_ALGORITHM", "HS256")
    max_ws_connections: int = int(_get_env("MAX_WS_CONNECTIONS", "60"))
    ws_heartbeat_seconds: int = int(_get_env("WS_HEARTBEAT_SECONDS", "25"))
    mongodb_max_pool_size: int = int(_get_env("MONGODB_MAX_POOL_SIZE", "100"))
    mongodb_min_pool_size: int = int(_get_env("MONGODB_MIN_POOL_SIZE", "10"))
    redis_url: str = _get_env("REDIS_URL", "redis://localhost:6379")
    redis_channel: str = _get_env("REDIS_CHANNEL", "realtime:stock_updates")
    redis_event_log_key: str = _get_env("REDIS_EVENT_LOG_KEY", "realtime:event_log")
    realtime_event_log_size: int = int(_get_env("REALTIME_EVENT_LOG_SIZE", "200"))
    use_memory_db: bool = str(_get_env("USE_MEMORY_DB", "false")).lower() in ("1", "true", "yes")
    app_env: str = _get_env("APP_ENV", "development")
    min_password_length: int = int(_get_env("MIN_PASSWORD_LENGTH", "8"))
    rate_limit_login_per_minute: int = int(_get_env("RATE_LIMIT_LOGIN_PER_MINUTE", "10"))
    rate_limit_api_per_minute: int = int(_get_env("RATE_LIMIT_API_PER_MINUTE", "120"))
    default_page_size: int = int(_get_env("DEFAULT_PAGE_SIZE", "100"))
    max_page_size: int = int(_get_env("MAX_PAGE_SIZE", "500"))
    require_open_shift_for_sales: bool = str(
        _get_env("REQUIRE_OPEN_SHIFT_FOR_SALES", "false")
    ).lower() in ("1", "true", "yes")

    # ── Email (Gmail SMTP) ──────────────────────────────────
    smtp_host: str = _get_env("SMTP_HOST", "smtp.gmail.com")
    smtp_port: int = int(_get_env("SMTP_PORT", "587"))
    smtp_user: str = _get_env("SMTP_USER", "")          # your Gmail address
    smtp_password: str = _get_env("SMTP_PASSWORD", "")  # Gmail App Password
    smtp_from_name: str = _get_env("SMTP_FROM_NAME", "Bar & Restaurant System")
    password_reset_expire_minutes: int = int(_get_env("PASSWORD_RESET_EXPIRE_MINUTES", "30"))

    @property
    def email_enabled(self) -> bool:
        return bool(self.smtp_user and self.smtp_password)

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"


settings = Settings()

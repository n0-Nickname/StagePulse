from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables or .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    app_env: Literal["dev", "prod"] = "dev"
    project_name: str = "Presentation Timer API"
    jwt_secret: SecretStr = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7
    database_url: str = ""
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )
    configured_log_level: str | None = Field(
        default=None,
        validation_alias="LOG_LEVEL",
    )

    @model_validator(mode="after")
    def validate_database_url(self) -> Self:
        """Default SQLite aiosqlite in dev; require postgresql+asyncpg in prod."""
        if self.app_env == "dev":
            if self.database_url == "":
                self.database_url = "sqlite+aiosqlite:///./presentation_timer.db"
            return self
        if not self.database_url.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "prod environment requires explicit postgresql+asyncpg:// database_url"
            )
        return self

    @property
    def log_level(self) -> str:
        """Return effective log level (DEBUG in dev, INFO in prod, or LOG_LEVEL)."""
        if self.configured_log_level is not None:
            stripped = self.configured_log_level.strip()
            if stripped != "":
                return stripped.upper()
        return "DEBUG" if self.app_env == "dev" else "INFO"


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings instance."""
    return Settings()


settings = get_settings()

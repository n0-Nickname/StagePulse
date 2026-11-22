import os


class Settings:
    PROJECT_NAME: str = "Presentation Timer API"
    SECRET_KEY: str = os.getenv("SECRET_KEY", "presentation-timer-dev-secret-key-change-in-prod-998877")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 7)))
    SQLITE_URL: str = os.getenv("SQLITE_URL", "sqlite:///./presentation_timer.db")
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


settings = Settings()

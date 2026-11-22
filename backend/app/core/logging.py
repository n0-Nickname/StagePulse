import json
import logging
from datetime import UTC, datetime
from logging.config import dictConfig
from typing import override

from app.core.config import Settings


class JsonFormatter(logging.Formatter):
    """Format log records as single-line JSON objects for production aggregation."""

    def __init__(self, *, app_env: str) -> None:
        super().__init__()
        self.app_env = app_env

    @override
    def format(self, record: logging.LogRecord) -> str:
        """Serialize a LogRecord into a single-line JSON string."""
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "env": self.app_env,
        }
        if isinstance(record.exc_info, tuple):
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(app_settings: Settings) -> None:
    """Configure application logging via dictConfig based on app_env and log_level."""
    level = app_settings.log_level
    if app_settings.app_env == "prod":
        dictConfig(
            {
                "version": 1,
                "disable_existing_loggers": False,
                "formatters": {
                    "default": {
                        "()": JsonFormatter,
                        "app_env": app_settings.app_env,
                    },
                },
                "handlers": {
                    "stdout": {
                        "class": "logging.StreamHandler",
                        "stream": "ext://sys.stdout",
                        "formatter": "default",
                        "level": level,
                    },
                },
                "root": {"handlers": ["stdout"], "level": level},
                "loggers": {
                    "uvicorn": {"level": level, "handlers": ["stdout"], "propagate": False},
                    "uvicorn.error": {"level": level, "handlers": ["stdout"], "propagate": False},
                    "uvicorn.access": {
                        "level": "WARNING",
                        "handlers": ["stdout"],
                        "propagate": False,
                    },
                },
            }
        )
        return

    dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {
                    "format": "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
                },
            },
            "handlers": {
                "stdout": {
                    "class": "logging.StreamHandler",
                    "stream": "ext://sys.stdout",
                    "formatter": "default",
                    "level": level,
                },
            },
            "root": {"handlers": ["stdout"], "level": level},
            "loggers": {
                "uvicorn": {"level": level, "handlers": ["stdout"], "propagate": False},
                "uvicorn.error": {"level": level, "handlers": ["stdout"], "propagate": False},
                "uvicorn.access": {
                    "level": "WARNING",
                    "handlers": ["stdout"],
                    "propagate": False,
                },
            },
        }
    )

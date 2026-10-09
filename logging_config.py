"""Application logging without source content or exception payloads."""

import logging
import os
import traceback
from contextvars import ContextVar
from functools import wraps
from time import perf_counter


request_id = ContextVar("request_id", default="-")


class ApplicationFormatter(logging.Formatter):
    def format(self, record):
        record.request_id = request_id.get()
        # Other handlers may have cached an exception including private data.
        previous = record.exc_text
        record.exc_text = None
        try:
            return super().format(record)
        finally:
            record.exc_text = previous

    def formatException(self, exc_info):
        # Validation/model errors can embed chat text and model responses.
        # Keep stack locations and the exception type, excluding its message.
        return "Traceback (exception message omitted):\n" + "".join(
            traceback.format_tb(exc_info[2])
        ) + exc_info[0].__name__


def configure_logging():
    """Configure only our namespace; leave server/library logging alone."""
    logger = logging.getLogger("mani")
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, None)
    invalid_level = not isinstance(level, int)
    logger.setLevel(logging.INFO if invalid_level else level)
    logger.propagate = False
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(ApplicationFormatter(
            "%(asctime)s %(levelname)s %(name)s request_id=%(request_id)s %(message)s"
        ))
        logger.addHandler(handler)
    if invalid_level:
        logger.warning("Invalid LOG_LEVEL; using INFO")


def logged_operation(logger, name, level=logging.INFO):
    """Log service boundaries without inspecting arguments or return values."""
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            started = perf_counter()
            logger.log(level, "%s started", name)
            try:
                result = function(*args, **kwargs)
            except Exception:
                logger.exception(
                    "%s failed duration_ms=%.1f", name,
                    (perf_counter() - started) * 1000,
                )
                raise
            logger.log(
                level, "%s completed duration_ms=%.1f", name,
                (perf_counter() - started) * 1000,
            )
            return result
        return wrapped
    return decorate

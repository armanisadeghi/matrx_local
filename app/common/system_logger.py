import logging
import os
import sys
import traceback
import re
from concurrent_log_handler import ConcurrentRotatingFileHandler
from app.config import LOG_LEVEL, LOG_DIR, MAX_LOG_FILE_SIZE, BACKUP_COUNT

# Ensure the log directory exists
os.makedirs(LOG_DIR, exist_ok=True)


class SensitiveDataFilter(logging.Filter):
    """Mask tokens in log messages."""

    def filter(self, record):
        # Sanitize the message template
        if isinstance(record.msg, str):
            record.msg = self._sanitize(record.msg)

        # Sanitize any arguments passed to the log call
        if record.args:
            new_args = []
            for arg in record.args:
                if isinstance(arg, str):
                    new_args.append(self._sanitize(arg))
                else:
                    new_args.append(arg)
            record.args = tuple(new_args)

        return True

    def _sanitize(self, text: str) -> str:
        """Apply multiple regex masks to a string."""
        # Mask query param: token=...
        text = re.sub(
            r"([?&]token=)([^& \t\n\r\f\v\"]+)",
            lambda m: m.group(1) + self._truncate(m.group(2)),
            text,
        )
        # Mask Bearer tokens: Bearer eyJ...
        text = re.sub(
            r"([Bb]earer\s+)([A-Za-z0-9._\-\/]+)",
            lambda m: (
                m.group(1) + self._truncate(m.group(2))
                if len(m.group(2)) > 30
                else m.group(0)
            ),
            text,
        )
        return text

    def _truncate(self, val: str) -> str:
        if len(val) < 40:
            return val
        return f"{val[:10]}...{val[-10:]}"


class SystemLogger:
    def __init__(self):
        self.logger = logging.getLogger("system_logger")
        self.console_handler = None
        self.configure_logging()

    def configure_logging(self):
        # Set the logging level dynamically
        level = getattr(logging, LOG_LEVEL.upper(), logging.DEBUG)
        self.logger.setLevel(level)

        # Add filtering for sensitive data
        sensitive_filter = SensitiveDataFilter()
        self.logger.addFilter(sensitive_filter)

        # Apply to uvicorn loggers too if they exist
        for u_logger_name in ["uvicorn", "uvicorn.access", "uvicorn.error"]:
            logging.getLogger(u_logger_name).addFilter(sensitive_filter)

        # Console Handler
        self.console_handler = logging.StreamHandler(sys.stdout)
        self.console_handler.setLevel(level)
        console_formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )
        self.console_handler.setFormatter(console_formatter)
        self.logger.addHandler(self.console_handler)

        # File Handler with Concurrent Rotation
        file_handler = ConcurrentRotatingFileHandler(
            os.path.join(LOG_DIR, "system.log"),
            maxBytes=MAX_LOG_FILE_SIZE,  # Use dynamic file size
            backupCount=BACKUP_COUNT,  # Use dynamic backup count
            encoding="utf-8",
        )
        file_handler.setLevel(level)
        file_formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )
        file_handler.setFormatter(file_formatter)
        self.logger.addHandler(file_handler)

    def disable_console_logging(self):
        if self.console_handler and self.console_handler in self.logger.handlers:
            self.logger.removeHandler(self.console_handler)

    def enable_console_logging(self):
        if self.console_handler and self.console_handler not in self.logger.handlers:
            self.logger.addHandler(self.console_handler)

    def _log(self, level, message, *args, **kwargs):
        extra = kwargs.pop("extra", {})
        exc_info = kwargs.pop("exc_info", None)

        if exc_info:
            extra["traceback"] = traceback.format_exc()

        try:
            self.logger.log(
                level, message, *args, extra=extra, exc_info=exc_info, **kwargs
            )
        except Exception as e:
            print(f"Logging error: {str(e)}")

    def debug(self, message, *args, **kwargs):
        self._log(logging.DEBUG, message, *args, **kwargs)

    def info(self, message, *args, **kwargs):
        self._log(logging.INFO, message, *args, **kwargs)

    def warning(self, message, *args, **kwargs):
        self._log(logging.WARNING, message, *args, **kwargs)

    def error(self, message, *args, **kwargs):
        self._log(logging.ERROR, message, *args, **kwargs)

    def critical(self, message, *args, **kwargs):
        self._log(logging.CRITICAL, message, *args, **kwargs)


# Create a global instance of the logger
system_logger = SystemLogger()


# Function to get the logger instance
def get_logger():
    return system_logger

import logging
import os
import sys
import traceback
from concurrent_log_handler import ConcurrentRotatingFileHandler
from app.config import LOG_LEVEL, LOG_DIR, MAX_LOG_FILE_SIZE, BACKUP_COUNT

# Ensure the log directory exists
os.makedirs(LOG_DIR, exist_ok=True)

class SystemLogger:
    def __init__(self):
        self.logger = logging.getLogger("system_logger")
        self.console_handler = None
        self.configure_logging()

    def configure_logging(self):
        # Set the logging level dynamically
        level = getattr(logging, LOG_LEVEL.upper(), logging.DEBUG)
        self.logger.setLevel(level)

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
            backupCount=BACKUP_COUNT,    # Use dynamic backup count
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
            self.logger.log(level, message, *args, extra=extra, exc_info=exc_info, **kwargs)
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

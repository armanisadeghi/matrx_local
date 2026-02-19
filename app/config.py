import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

APP_NAME = "MatrxLocal"
DEBUG = os.getenv("DEBUG", "True").lower() in ("true", "1")
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key")

_DEFAULT_ORIGINS = ",".join([
    "https://aimatrx.com",
    "https://www.aimatrx.com",
    "http://localhost:1420",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:5173",
    "http://127.0.0.1:1420",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:5173",
    "tauri://localhost",
])
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",")

DATABASE_URL = os.getenv("DATABASE_URL", "")

# Remote scraper server (dedicated server at scraper.app.matrxserver.com)
SCRAPER_API_KEY = os.getenv("SCRAPER_API_KEY", "")
SCRAPER_SERVER_URL = os.getenv("SCRAPER_SERVER_URL", "https://scraper.app.matrxserver.com")

TEMP_DIR = BASE_DIR / "system" / "temp"
DATA_DIR = BASE_DIR / "system" / "data"
CONFIG_DIR = BASE_DIR / "system" / "config"
LOCAL_LOG_DIR = BASE_DIR / "system" / "logs"
CODE_SAVES_DIR = BASE_DIR / "system" / "temp" / "code_saves"

LOG_VCPRINT = True

LOG_LEVEL = os.getenv("LOG_LEVEL", "DEBUG")
LOG_DIR = os.getenv("LOG_DIR", LOCAL_LOG_DIR)
MAX_LOG_FILE_SIZE = int(os.getenv("MAX_LOG_FILE_SIZE", 10 * 1024 * 1024))
BACKUP_COUNT = int(os.getenv("BACKUP_COUNT", 5))

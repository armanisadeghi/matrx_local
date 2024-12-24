import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

APP_NAME = "MatrxLocal"
DEBUG = os.getenv("DEBUG", "True").lower() in ("true", "1")
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://arman:ab1234@localhost/matrx_local")

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

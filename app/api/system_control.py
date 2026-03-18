import os

from app.common.platform_ctx import PLATFORM


def get_system_info():
    return {
        "os": PLATFORM["os"],
        "cwd": os.getcwd(),
    }

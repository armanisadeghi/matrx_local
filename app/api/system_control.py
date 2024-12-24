import os

def get_system_info():
    return {
        "os": os.name,
        "cwd": os.getcwd(),
    }

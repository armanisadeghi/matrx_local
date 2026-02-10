from pystray import Icon, Menu, MenuItem
from PIL import Image
import threading
import uvicorn

from app.main import app


def create_image():
    image_path = "static/apple-touch-icon.png"
    return Image.open(image_path)


def start_fastapi():
    uvicorn.run(app, host="127.0.0.1", port=8000)


def on_quit(icon, item):
    icon.stop()


def setup_tray():
    menu = Menu(
        MenuItem("Quit", on_quit)
    )
    icon = Icon("matrx_local", create_image(), "Matrx Local", menu)
    icon.run()


if __name__ == "__main__":
    api_thread = threading.Thread(target=start_fastapi, daemon=True)
    api_thread.start()
    setup_tray()

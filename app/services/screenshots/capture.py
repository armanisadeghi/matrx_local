from PIL import ImageGrab

def take_screenshot(output_path: str = "screenshot.png"):
    screenshot = ImageGrab.grab()
    screenshot.save(output_path)
    return output_path

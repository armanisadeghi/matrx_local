import platform


def take_screenshot(output_path: str = "screenshot.png"):
    if platform.system() == "Darwin":
        try:
            import Quartz

            cg_image = Quartz.CGDisplayCreateImage(Quartz.CGMainDisplayID())
            if cg_image is None:
                raise OSError("Screen capture failed — permission may be required")

            url = Quartz.CFURLCreateWithFileSystemPath(
                None, output_path, Quartz.kCFURLPOSIXPathStyle, False
            )
            dest = Quartz.CGImageDestinationCreateWithURL(url, "public.png", 1, None)
            if dest is None:
                raise OSError("Failed to create image destination")
            Quartz.CGImageDestinationAddImage(dest, cg_image, None)
            if not Quartz.CGImageDestinationFinalize(dest):
                raise OSError("Failed to finalize screenshot")
            return output_path
        except ImportError:
            pass  # pyobjc not available, fall through to PIL

    from PIL import ImageGrab

    screenshot = ImageGrab.grab()
    screenshot.save(output_path)
    return output_path

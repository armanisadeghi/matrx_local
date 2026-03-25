"""Image generation service — optional feature requiring diffusers + torch."""
from app.services.image_gen.service import get_image_gen_service, ImageGenService

__all__ = ["get_image_gen_service", "ImageGenService"]

from __future__ import annotations

import io
import json
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import fitz
    FITZ_AVAILABLE = True
except ImportError:
    FITZ_AVAILABLE = False

try:
    import pytesseract
    from PIL import Image
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False

OCR_CONFIG = r"--oem 3 --psm 6"
OCR_DPI = 300
OCR_LOW_TEXT_THRESHOLD = 50


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> Optional[str]:
    if not FITZ_AVAILABLE:
        logger.error("PyMuPDF (fitz) not installed — cannot extract PDF text")
        return None
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            all_text: list[str] = []
            for page_num, page in enumerate(doc, start=1):
                page_text = page.get_text("text")
                if len(page_text.strip()) < OCR_LOW_TEXT_THRESHOLD and OCR_AVAILABLE:
                    ocr_text = _ocr_pdf_page(page, page_num)
                    if len(ocr_text.strip()) > len(page_text.strip()):
                        page_text = ocr_text
                all_text.append(page_text)
            full_text = "\n".join(all_text).strip()
            return full_text if full_text else None
    except Exception:
        logger.exception("Error extracting text from PDF")
        return None


def _ocr_pdf_page(page: object, page_num: int) -> str:
    if not OCR_AVAILABLE:
        return ""
    try:
        pix = page.get_pixmap(dpi=OCR_DPI)  # type: ignore[attr-defined]
        img_data = pix.pil_tobytes(format="jpeg")
        img = Image.open(io.BytesIO(img_data))
        text = pytesseract.image_to_string(img, config=OCR_CONFIG)
        return text
    except Exception:
        logger.warning("OCR failed on PDF page %d", page_num)
        return ""


def extract_text_from_image_bytes(image_bytes: bytes) -> Optional[str]:
    if not OCR_AVAILABLE:
        logger.error("pytesseract/Pillow not installed — cannot extract image text")
        return None
    try:
        img = Image.open(io.BytesIO(image_bytes))
        text = pytesseract.image_to_string(img, config=OCR_CONFIG)
        return text.strip() if text.strip() else None
    except Exception:
        logger.exception("Error extracting text from image")
        return None


def format_json_content(text: str) -> Optional[str]:
    try:
        parsed = json.loads(text)
        return json.dumps(parsed, indent=2, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
        return text if text.strip() else None


def extract_xml_text(text: str) -> Optional[str]:
    cleaned = re.sub(r"<[^>]+>", " ", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned if cleaned else None


def extract_text_content(text: str, content_type_value: str) -> Optional[str]:
    if content_type_value in ("md", "txt"):
        return text.strip() if text.strip() else None
    elif content_type_value == "json":
        return format_json_content(text)
    elif content_type_value == "xml":
        return extract_xml_text(text)
    return text.strip() if text.strip() else None

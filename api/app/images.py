"""Image intake shared by repair photos, payment slips and fine evidence.
Accept only real JPEG/PNG/WEBP, re-encode to drop EXIF (GPS location) and anything hidden in the file."""
import io

from PIL import Image, ImageOps, UnidentifiedImageError

from .core import ApiError

MAX_SIDE = 1600
Image.MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard


def clean_image(raw: bytes, max_side: int = MAX_SIDE):
    try:
        probe = Image.open(io.BytesIO(raw))
        fmt = probe.format
        probe.verify()
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError):
        raise ApiError(400, "bad_image", "ไฟล์ต้องเป็นรูปภาพ JPG, PNG หรือ WEBP")
    if fmt not in ("JPEG", "PNG", "WEBP"):
        raise ApiError(400, "bad_image", "ไฟล์ต้องเป็นรูปภาพ JPG, PNG หรือ WEBP")
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    if fmt == "PNG":
        img.save(out, "PNG", optimize=True)
        mime = "image/png"
    elif fmt == "WEBP":
        img.save(out, "WEBP", quality=85)
        mime = "image/webp"
    else:
        img.convert("RGB").save(out, "JPEG", quality=85)
        mime = "image/jpeg"
    return mime, out.getvalue()


async def read_images(files, max_files: int, max_total: int):
    files = [f for f in (files or []) if f and f.filename]
    if len(files) > max_files:
        raise ApiError(400, "too_many_photos", f"แนบรูปได้ไม่เกิน {max_files} รูป")
    cleaned, total = [], 0
    for f in files:
        raw = await f.read(max_total + 1)
        total += len(raw)
        if total > max_total:
            raise ApiError(413, "too_large", f"รูปรวมกันต้องไม่เกิน {max_total // (1024 * 1024)} MB")
        cleaned.append(clean_image(raw))
    return cleaned

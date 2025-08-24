import base64
import io
import mimetypes
import os
import re
import tempfile
import time
import uuid
from typing import Tuple, Optional
import sys
import argparse

from PIL import Image
import logging


_DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<data>.+)$", re.DOTALL)

log = logging.getLogger(__name__)


def randomized_filename(extension: Optional[str] = ".png") -> str:
    """
    Return a randomized, non-identifying filename with the provided extension.
    Example: img_8b1a9953.png (no timestamp)
    """
    ext = extension or ""
    if ext and not ext.startswith("."):
        ext = "." + ext
    return f"img_{uuid.uuid4().hex[:8]}{ext}"


def _ensure_rgb(img: Image.Image) -> Image.Image:
    # Convert to a safe color mode (drop alpha to avoid accidental overlays of private content)
    if img.mode in ("RGB", "L"):
        return img
    return img.convert("RGB")


def sanitize_image_bytes(
    image_bytes: bytes,
    output_format: str = "PNG",
    max_dim: int = 2048,
) -> Tuple[bytes, str]:
    """
    Sanitize an image by re-encoding without metadata (EXIF/ICC), optionally downscaling.
    Returns (sanitized_bytes, mime_type).
    """
    log.info(
        "sanitize_image_bytes: start bytes=%d fmt=%s max_dim=%d",
        len(image_bytes or b""), output_format, max_dim,
    )
    with Image.open(io.BytesIO(image_bytes)) as img:
        # Fully load to detach from underlying file
        img.load()
        img = _ensure_rgb(img)
        # Downscale while keeping aspect ratio
        if max(img.size) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)
        # Aggressively strip all metadata from PIL Image
        # Clear info dict (drops ICC profile, XMP, tEXt, etc.)
        try:
            img = img.copy()
            img.info.clear()
        except Exception:
            try:
                for k in list(img.info.keys()):
                    img.info.pop(k, None)
            except Exception:
                pass

        out = io.BytesIO()
        fmt = (output_format or "PNG").upper()
        if fmt == "PNG":
            # Do not pass any pnginfo or icc_profile to ensure a clean file
            img.save(out, format="PNG", optimize=True)
            mime = "image/png"
        elif fmt in ("JPG", "JPEG"):
            # Save without EXIF/ICC
            img.save(out, format="JPEG", quality=90, optimize=True)
            mime = "image/jpeg"
        else:
            img.save(out, format=fmt)
            mime = mimetypes.guess_type(f"file.{fmt.lower()}")[0] or "application/octet-stream"
        cleaned = out.getvalue()
        try:
            w, h = img.size
        except Exception:
            w = h = -1
        log.info(
            "sanitize_image_bytes: done bytes_in=%d bytes_out=%d mime=%s dims=%sx%s",
            len(image_bytes or b""), len(cleaned or b""), mime, w, h,
        )
        return cleaned, mime


def data_url_to_bytes(data_url: str) -> Tuple[bytes, str]:
    m = _DATA_URL_RE.match(data_url.strip())
    if not m:
        raise ValueError("Invalid data URL; expected 'data:<mime>;base64,<data>'")
    mime = m.group("mime").lower()
    b = base64.b64decode(m.group("data"), validate=True)
    log.info("data_url_to_bytes: parsed mime=%s bytes=%d", mime, len(b or b""))
    return b, mime


def bytes_to_data_url(b: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(b).decode('ascii')}"


def sanitize_data_url(data_url: str, output_format: str = "PNG", max_dim: int = 2048) -> str:
    """
    Sanitize a data URL by decoding, removing metadata, and re-encoding (default PNG).
    Returns a new data URL string.
    """
    log.info("sanitize_data_url: start")
    raw, _ = data_url_to_bytes(data_url)
    cleaned, mime = sanitize_image_bytes(raw, output_format=output_format, max_dim=max_dim)
    log.info("sanitize_data_url: done bytes=%d mime=%s", len(cleaned or b""), mime)
    return bytes_to_data_url(cleaned, mime)


def sanitize_file_to_temp(
    file_path: str,
    output_format: str = "PNG",
    max_dim: int = 2048,
) -> str:
    """
    Sanitize image at file_path and write to a new randomized temp file.
    Returns the path to the sanitized temp file. Caller is responsible for deletion.
    """
    log.info("sanitize_file_to_temp: start src=%s", os.path.basename(file_path))
    with open(file_path, "rb") as f:
        raw = f.read()
    cleaned, mime = sanitize_image_bytes(raw, output_format=output_format, max_dim=max_dim)
    ext = ".png" if mime == "image/png" else ".jpg"
    rand_name = randomized_filename(ext)
    # Create in system temp dir
    tmp_dir = tempfile.gettempdir()
    out_path = os.path.join(tmp_dir, rand_name)
    with open(out_path, "wb") as f:
        f.write(cleaned)
    # Normalize file metadata (times/permissions) for anonymization
    try:
        # Set atime/mtime to a fixed epoch (2000-01-01 UTC)
        epoch = 946684800
        os.utime(out_path, (epoch, epoch))
    except Exception:
        pass
    try:
        os.chmod(out_path, 0o644)
    except Exception:
        pass
    log.info(
        "sanitize_file_to_temp: wrote dst=%s bytes=%d mime=%s", os.path.basename(out_path), len(cleaned or b""), mime
    )
    return out_path


class TemporarySanitizedImage:
    """
    Context manager that produces a sanitized temp file which is deleted on exit.

    Usage:
        with TemporarySanitizedImage("/path/to/image.jpg") as tmp_path:
            # upload tmp_path then return; file is removed afterwards
            pass
    """

    def __init__(self, file_path: str, output_format: str = "PNG", max_dim: int = 2048):
        self._src = file_path
        self._fmt = output_format
        self._max = max_dim
        self._tmp: Optional[str] = None

    def __enter__(self) -> str:
        log.info("TemporarySanitizedImage.__enter__: src=%s", os.path.basename(self._src))
        self._tmp = sanitize_file_to_temp(self._src, output_format=self._fmt, max_dim=self._max)
        return self._tmp

    def __exit__(self, exc_type, exc, tb):
        try:
            if self._tmp and os.path.exists(self._tmp):
                os.remove(self._tmp)
                log.info("TemporarySanitizedImage.__exit__: removed %s", os.path.basename(self._tmp))
        finally:
            self._tmp = None


def _cli() -> int:
    parser = argparse.ArgumentParser(description="Sanitize image data by removing metadata and re-encoding.")
    parser.add_argument("--output-format", default="PNG", help="Output format (PNG or JPEG)")
    parser.add_argument("--max-dim", type=int, default=2048, help="Max dimension for downscaling")
    parser.add_argument("--mode", choices=["data-url"], default="data-url", help="Input mode; currently only 'data-url' via stdin")
    args = parser.parse_args()

    try:
        data = sys.stdin.read().strip()
        if not data:
            print("", end="")
            return 0
        if args.mode == "data-url":
            out = sanitize_data_url(data, output_format=args.output_format, max_dim=args.max_dim)
            sys.stdout.write(out)
            sys.stdout.flush()
            return 0
    except Exception as e:
        log.exception("CLI sanitize failed")
        sys.stderr.write(str(e))
        sys.stderr.flush()
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())

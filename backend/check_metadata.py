#!/usr/bin/env python3
"""
check_metadata.py

A small CLI to inspect image metadata and (optionally) verify that
sanitization removes it. Useful for testing the backend sanitizer.

Usage examples:
  # Show metadata of an image
  python3 backend/check_metadata.py /path/to/image.jpg

  # Compare metadata before and after sanitization
  python3 backend/check_metadata.py /path/to/image.jpg --sanitize

  # Emit JSON for automation
  python3 backend/check_metadata.py /path/to/image.jpg --sanitize --json
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Tuple

from PIL import Image, ExifTags

# Local import from the sanitizer module in the same directory
from image_sanitizer import sanitize_image_bytes, sanitize_file_to_temp

_DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<data>.+)$", re.DOTALL)


def _read_bytes(path_or_dataurl: str) -> Tuple[bytes, str, str | None]:
    """Return (bytes, source_desc, absolute_path|None) from a file or data URL."""
    if os.path.isfile(path_or_dataurl):
        abs_path = os.path.abspath(path_or_dataurl)
        with open(path_or_dataurl, "rb") as f:
            return f.read(), os.path.basename(path_or_dataurl), abs_path
    m = _DATA_URL_RE.match(path_or_dataurl.strip())
    if m:
        return base64.b64decode(m.group("data"), validate=True), "<data-url>", None
    raise FileNotFoundError(f"Input is neither a file nor a data URL: {path_or_dataurl!r}")


def _file_stat_report(path: str) -> Dict[str, Any]:
    st = os.stat(path)
    def ts(t: float) -> str:
        return datetime.fromtimestamp(t, tz=timezone.utc).isoformat()
    rep = {
        "basename": os.path.basename(path),
        "dir": os.path.dirname(path),
        "size_bytes": st.st_size,
        "mode": oct(st.st_mode & 0o777),
        "mtime": ts(st.st_mtime),
        "atime": ts(st.st_atime),
    }
    # ctime is metadata change time on Unix; birth time on macOS
    try:
        rep["ctime"] = ts(st.st_ctime)
    except Exception:
        pass
    # birthtime (macOS)
    bt = getattr(st, "st_birthtime", None)
    if bt is not None:
        rep["birthtime"] = ts(bt)
    return rep


def _exif_dict(img: Image.Image) -> Dict[str, Any]:
    try:
        exif = img.getexif()
    except Exception:
        exif = None
    if not exif:
        return {}
    out: Dict[str, Any] = {}
    for tag_id, value in exif.items():
        name = ExifTags.TAGS.get(tag_id, f"Unknown_{tag_id}")
        if isinstance(value, (bytes, bytearray)):
            out[name] = f"<bytes:{len(value)}>"
        else:
            try:
                out[name] = str(value)
            except Exception:
                out[name] = repr(value)
    return out


def extract_metadata_report(image_bytes: bytes, *, exif_full: bool = False) -> Dict[str, Any]:
    """Inspect image bytes and return a detailed metadata report."""
    sha256 = hashlib.sha256(image_bytes).hexdigest()
    with Image.open(io.BytesIO(image_bytes)) as img:
        report: Dict[str, Any] = {
            "format": img.format,
            "mode": img.mode,
            "size": list(img.size),  # [w, h]
            "sha256": sha256,
        }
        # ICC profile & info keys
        icc_raw = img.info.get("icc_profile")
        info_keys = sorted(k for k in img.info.keys() if k != "icc_profile")
        icc_sha = hashlib.sha256(icc_raw).hexdigest() if isinstance(icc_raw, (bytes, bytearray)) and icc_raw else None
        info_detail = {}
        for k in info_keys:
            v = img.info.get(k)
            if isinstance(v, (bytes, bytearray)):
                info_detail[k] = {"type": "bytes", "len": len(v)}
            else:
                try:
                    s = str(v)
                except Exception:
                    s = repr(v)
                info_detail[k] = {"type": type(v).__name__, "len": len(s)}
        report.update(
            {
                "icc_profile_present": bool(icc_raw),
                "icc_profile_bytes": (len(icc_raw) if isinstance(icc_raw, (bytes, bytearray)) else 0),
                "icc_profile_sha256": icc_sha,
                "info_keys": info_keys,
                "info_detail": info_detail,
            }
        )
        # EXIF
        exif_map = _exif_dict(img)
        report["exif_present"] = bool(exif_map)
        report["exif_count"] = len(exif_map)
        if exif_full:
            report["exif"] = exif_map
        else:
            subset_keys = [
                "DateTime",
                "DateTimeOriginal",
                "DateTimeDigitized",
                "Make",
                "Model",
                "Software",
                "Artist",
                "Copyright",
                "GPSInfo",
            ]
            subset = {k: exif_map[k] for k in subset_keys if k in exif_map}
            if subset:
                report["exif_subset"] = subset

        # Heuristic XMP detection: scan original bytes
        b = image_bytes
        has_xmp = (b.find(b"<x:xmpmeta") != -1) or (b.find(b"http://ns.adobe.com/xap/1.0/") != -1)
        report["xmp_present"] = has_xmp

        return report


def main() -> int:
    p = argparse.ArgumentParser(description="Inspect image metadata and optionally compare after sanitization.")
    p.add_argument("input", help="Path to image file or data URL")
    p.add_argument("--sanitize", action="store_true", help="Run the image through the sanitizer and report both")
    p.add_argument("--output-format", default="PNG", help="Sanitizer output format when --sanitize is used (PNG/JPEG)")
    p.add_argument("--max-dim", type=int, default=2048, help="Sanitizer max dimension when --sanitize is used")
    p.add_argument("--exif-full", action="store_true", help="Include full EXIF map instead of subset")
    p.add_argument("--json", action="store_true", help="Emit JSON instead of text")
    p.add_argument("--cleanup", action="store_true", help="Delete the sanitized temp file after reporting")
    args = p.parse_args()

    data, src, abs_path = _read_bytes(args.input)

    report_before = extract_metadata_report(data, exif_full=args.exif_full)
    out: Dict[str, Any] = {"source": src, "before": report_before}
    if abs_path:
        out["source_file"] = _file_stat_report(abs_path)

    if args.sanitize:
        # Produce an actual sanitized file to report its filename and file stats
        sanitized_path = sanitize_file_to_temp(abs_path or args.input, output_format=args.output_format, max_dim=args.max_dim)
        with open(sanitized_path, "rb") as f:
            sanitized_bytes = f.read()
        report_after = extract_metadata_report(sanitized_bytes, exif_full=args.exif_full)
        out["sanitized"] = {
            "file": _file_stat_report(sanitized_path),
            "report": report_after,
        }
        out["sanitized_mime"] = report_after.get("format") and ("image/" + report_after["format"].lower())

        if args.cleanup:
            try:
                os.remove(sanitized_path)
                out["sanitized"]["file"]["deleted"] = True
            except Exception as e:
                out["sanitized"]["file"]["delete_error"] = str(e)

    if args.json:
        print(json.dumps(out, indent=2, sort_keys=True))
    else:
        def section(title: str) -> None:
            print("")
            print(title)
            print("")

        def dump_dict(d: Dict[str, Any], indent: int = 0) -> None:
            if not isinstance(d, dict):
                print(" " * indent + str(d))
                return
            keys = sorted(d.keys())
            key_width = max((len(str(k)) for k in keys), default=0)
            for k in keys:
                v = d[k]
                if isinstance(v, dict):
                    print(" " * indent + f"{k}:")
                    dump_dict(v, indent + 2)
                else:
                    print(" " * indent + f"{str(k):<{key_width}} : {v}")

        print(f"Source: {out['source']}")
        if "source_file" in out:
            section("-- SOURCE FILE --")
            dump_dict(out["source_file"]) 
        section("-- BEFORE --")
        dump_dict(out["before"]) 
        if "sanitized" in out:
            section("-- SANITIZED FILE --")
            dump_dict(out["sanitized"]["file"]) 
            section("-- AFTER --")
            dump_dict(out["sanitized"]["report"]) 
            print("")
            print(f"sanitized_mime: {out.get('sanitized_mime')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

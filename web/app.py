import io
import os
import sys
from pathlib import Path
from dataclasses import asdict
from typing import List, Optional, Set
from zipfile import ZipFile, ZIP_DEFLATED

from flask import Flask, jsonify, request, send_file, send_from_directory
from PIL import Image
from werkzeug.utils import secure_filename

# Ensure project root is on path so we can import ASCII.py when running from web/
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Import local ascii utilities
from ASCII import ASCIISettings, ascii_to_png, image_to_ascii, input_folder

app = Flask(
    __name__,
    static_folder=str(ROOT / "static"),
    template_folder=str(ROOT / "templates"),
)

# In-memory last image and settings
last_image: Optional[Image.Image] = None
last_image_name: Optional[str] = None

TRUE_VALUES = {"1", "true", "yes", "on", "y", "t"}
FALSE_VALUES = {"0", "false", "no", "off", "n", "f"}


def _normalize_source(source):
    if source is None:
        return None
    if hasattr(source, "to_dict"):
        try:
            return source.to_dict(flat=True)
        except TypeError:
            return source.to_dict()
    return source


def _parse_bool(value, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        v = value.strip().lower()
        if v in TRUE_VALUES:
            return True
        if v in FALSE_VALUES:
            return False
    return default


def _unique_name(base: str, used: Set[str]) -> str:
    candidate = base
    suffix = 1
    while candidate in used:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def _resolve_archive_name(candidate: Optional[str], default: str) -> str:
    if not candidate:
        return default
    cleaned = secure_filename(str(candidate))
    if not cleaned:
        return default
    if not cleaned.lower().endswith(".zip"):
        cleaned += ".zip"
    return cleaned


def _write_ascii_outputs(
    archive: ZipFile,
    ascii_art: str,
    base_name: str,
    settings: ASCIISettings,
    include_txt: bool,
    include_png: bool,
) -> None:
    if include_txt:
        archive.writestr(f"{base_name}.txt", ascii_art)
    if include_png:
        png_img = ascii_to_png(ascii_art, None, settings)
        buf = io.BytesIO()
        png_img.save(buf, format="PNG")
        archive.writestr(f"{base_name}.png", buf.getvalue())


def get_settings_from_request(source=None) -> ASCIISettings:
    # Parse settings from request args/form/json
    if source is None:
        source = request.get_json(silent=True) or request.form or request.args
    source = _normalize_source(source)
    if not source:
        return ASCIISettings()

    def to_int(name, default):
        try:
            return int(source.get(name, default))
        except Exception:
            return default

    def to_float(name, default):
        try:
            return float(source.get(name, default))
        except Exception:
            return default

    def to_bool(name, default):
        v = source.get(name, default)
        return _parse_bool(v, default)

    chars = source.get("ascii_chars")
    if chars is None or chars == "":
        chars = "@%#*+=-:. "

    settings = ASCIISettings(
        output_width=to_int("output_width", 120),
        ascii_chars=chars,
        black_threshold=to_int("black_threshold", 15),
        invert=to_bool("invert", False),
        char_aspect=to_float("char_aspect", 0.55),
        font_path=source.get("font_path") or None,
        font_size=to_int("font_size", 12),
        fg_color=source.get("fg_color") or "black",
        bg_color=source.get("bg_color") or "white",
    )
    return settings


@app.route("/")
def index():
    return send_from_directory(str(ROOT), "index.html")


@app.route("/api/preview", methods=["POST"])
def api_preview():
    global last_image, last_image_name

    # Accept file upload or use last_image
    file = request.files.get("file")
    if file:
        try:
            img = Image.open(file.stream).convert("RGB")
            last_image = img
            last_image_name = getattr(file, 'filename', None)
        except Exception as e:
            return jsonify({"error": f"Invalid image: {e}"}), 400
    elif last_image is None:
        return jsonify({"error": "No image uploaded yet"}), 400
    else:
        img = last_image

    settings = get_settings_from_request()
    ascii_art = image_to_ascii(img, settings)
    png_img = ascii_to_png(ascii_art, None, settings)

    buf = io.BytesIO()
    png_img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")


@app.route("/api/settings", methods=["GET"]) 
def api_settings():
    # Provide default settings to the UI
    return jsonify(asdict(ASCIISettings()))


@app.route("/api/batch_upload", methods=["POST"])
def api_batch_upload():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files uploaded"}), 400

    form_source = request.form or None
    settings = get_settings_from_request(form_source)
    source_map = _normalize_source(form_source) or {}
    include_txt = _parse_bool(source_map.get("include_txt", True), True)
    include_png = _parse_bool(source_map.get("include_png", True), True)
    if not include_txt and not include_png:
        include_txt = True

    converted = 0
    errors: List[str] = []
    used_names: Set[str] = set()
    buf = io.BytesIO()

    with ZipFile(buf, "w", ZIP_DEFLATED) as archive:
        for idx, file in enumerate(files, start=1):
            filename = getattr(file, "filename", None) or ""
            if not filename:
                errors.append(f"Skipped unnamed file #{idx}")
                continue
            try:
                with Image.open(file.stream) as raw:
                    img = raw.convert("RGB")
            except Exception as exc:
                errors.append(f"{filename}: {exc}")
                continue

            ascii_art = image_to_ascii(img, settings)
            cleaned = secure_filename(filename)
            base = Path(cleaned).stem or f"image_{idx}"
            base_name = _unique_name(base, used_names)
            _write_ascii_outputs(archive, ascii_art, base_name, settings, include_txt, include_png)
            converted += 1

        if errors and converted:
            archive.writestr("_errors.txt", "\n".join(errors))

    if not converted:
        message = errors[0] if errors else "No valid images were provided."
        return jsonify({"error": message}), 400

    buf.seek(0)
    archive_name = _resolve_archive_name(source_map.get("archive_name"), "ascii_batch_upload.zip")
    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name=archive_name,
    )


@app.route("/api/list_input", methods=["GET"]) 
def api_list_input():
    try:
        items = [
            f for f in sorted(os.listdir(input_folder))
            if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp"))
        ]
        return jsonify({"files": items})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/select", methods=["POST"]) 
def api_select():
    """Select an image from the input folder as the active image."""
    global last_image, last_image_name
    name = request.values.get("name")
    if not name:
        return jsonify({"error": "Missing name"}), 400
    path = os.path.join(input_folder, name)
    if not os.path.isfile(path):
        return jsonify({"error": "Not found"}), 404
    try:
        img = Image.open(path).convert("RGB")
    except Exception as e:
        return jsonify({"error": f"Failed to open: {e}"}), 400
    last_image = img
    last_image_name = name
    return jsonify({"ok": True, "name": name})


@app.route("/api/batch_input", methods=["POST"])
def api_batch_input():
    data = request.get_json(silent=True) or {}
    names = data.get("names") or []
    if isinstance(names, str):
        names = [names]
    names = [str(name) for name in names if str(name).strip()]
    if not names:
        return jsonify({"error": "No input files selected"}), 400

    include_txt = _parse_bool(data.get("include_txt", True), True)
    include_png = _parse_bool(data.get("include_png", True), True)
    if not include_txt and not include_png:
        include_txt = True

    settings = get_settings_from_request(data)
    converted = 0
    errors: List[str] = []
    used_names: Set[str] = set()
    buf = io.BytesIO()

    with ZipFile(buf, "w", ZIP_DEFLATED) as archive:
        for idx, name in enumerate(names, start=1):
            path = Path(input_folder) / name
            if not path.exists():
                errors.append(f"{name}: not found in input folder")
                continue
            try:
                with Image.open(path) as raw:
                    img = raw.convert("RGB")
            except Exception as exc:
                errors.append(f"{name}: {exc}")
                continue

            ascii_art = image_to_ascii(img, settings)
            base = Path(name).stem or f"input_{idx}"
            base_name = _unique_name(base, used_names)
            _write_ascii_outputs(archive, ascii_art, base_name, settings, include_txt, include_png)
            converted += 1

        if errors and converted:
            archive.writestr("_errors.txt", "\n".join(errors))

    if not converted:
        message = errors[0] if errors else "No files converted."
        return jsonify({"error": message}), 400

    buf.seek(0)
    archive_name = _resolve_archive_name(data.get("archive_name"), "ascii_batch_input.zip")
    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name=archive_name,
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="127.0.0.1", port=port, debug=True)

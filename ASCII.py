import os
from dataclasses import dataclass
from io import BytesIO
from typing import Iterable, List, Optional, Tuple, Union

from PIL import Image, ImageDraw, ImageFont

input_folder = "input"

output_txt_folder = "output-txt"
output_png_folder = "output-png"

ASCII_CHARS = "@%#*+=-:. "

OUTPUT_WIDTH = 700

BLACK_THRESHOLD = 1

# Prefer a Windows-safe default; fallback to common macOS path; finally Pillow default
DEFAULT_FONT_PATHS = [
    "/System/Library/Fonts/Monaco.ttf",
]

FONT_SIZE = 4


@dataclass
class ASCIISettings:
    """Settings to control ASCII rendering."""
    output_width: int = OUTPUT_WIDTH
    ascii_chars: str = ASCII_CHARS
    black_threshold: int = BLACK_THRESHOLD
    invert: bool = True
    char_aspect: float = 0.55  # height/width correction for typical monospace fonts
    font_path: Optional[str] = None  # if None, auto-pick
    font_size: int = FONT_SIZE
    fg_color: str = "white"
    bg_color: str = "black"

    def resolve_font(self) -> ImageFont.FreeTypeFont:
        """Return a truetype font, falling back to Pillow's default if not found."""
        path = self.font_path
        font: Optional[ImageFont.ImageFont] = None
        if path and os.path.exists(path):
            try:
                return ImageFont.truetype(path, self.font_size)
            except Exception:
                pass
        for candidate in DEFAULT_FONT_PATHS:
            if os.path.exists(candidate):
                try:
                    return ImageFont.truetype(candidate, self.font_size)
                except Exception:
                    continue
        # Fallback to default bitmap font
        return ImageFont.load_default()


def _prepare_image(img: Image.Image, width: int, char_aspect: float) -> Image.Image:
    # convert to grayscale and resize keeping aspect with character aspect correction
    img = img.convert("L")
    aspect_ratio = img.height / img.width
    new_height = max(1, int(width * aspect_ratio * char_aspect))
    return img.resize((width, new_height))


def image_to_ascii(
    image: Union[str, Image.Image],
    settings: Optional[ASCIISettings] = None,
) -> str:
    """Convert an image or image path to ASCII art string.

    - Applies a near-black threshold to produce blank spaces
    - Maps remaining values to the provided ascii_chars
    """
    s = settings or ASCIISettings()
    # Load if needed
    img = Image.open(image) if isinstance(image, str) else image
    img = _prepare_image(img, s.output_width, s.char_aspect)

    pixels = list(img.getdata())
    if s.invert:
        pixels = [255 - p for p in pixels]

    chars = s.ascii_chars if s.ascii_chars else ASCII_CHARS
    n = len(chars)
    black = max(0, min(255, s.black_threshold))
    out: List[str] = []
    for p in pixels:
        if p <= black:
            out.append(" ")
        else:
            out.append(chars[p * n // 256])

    # Break into fixed-width lines
    w = img.width
    lines = ["".join(out[i : i + w]) for i in range(0, len(out), w)]
    return "\n".join(lines)


def ascii_to_png(
    ascii_art: str,
    output_path: Optional[str] = None,
    settings: Optional[ASCIISettings] = None,
) -> Union[Image.Image, None]:
    """Render ASCII text to a PNG image using Pillow.

    If output_path is provided, saves the image and returns None.
    Otherwise, returns the PIL Image object.
    """
    s = settings or ASCIISettings()
    lines = ascii_art.split("\n")
    if not lines:
        lines = [""]

    font = s.resolve_font()
    # getbbox is preferred; fallback to getsize for Pillow variants
    try:
        bbox = font.getbbox("A" if any(lines) else " ")
        char_width = max(1, bbox[2] - bbox[0])
        char_height = max(1, bbox[3] - bbox[1])
    except Exception:
        char_width, char_height = font.getsize("A")

    max_line_len = max((len(l) for l in lines), default=0)
    img_width = max(1, char_width * max_line_len)
    img_height = max(1, char_height * len(lines))

    img = Image.new("RGB", (img_width, img_height), s.bg_color)
    draw = ImageDraw.Draw(img)

    for i, line in enumerate(lines):
        draw.text((0, i * char_height), line, font=font, fill=s.fg_color)

    if output_path:
        img.save(output_path)
        return None
    return img

def process_frames(
    input_folder: str,
    txt_folder: str,
    png_folder: str,
    settings: Optional[ASCIISettings] = None,
):
    s = settings or ASCIISettings()
    os.makedirs(txt_folder, exist_ok=True)
    os.makedirs(png_folder, exist_ok=True)

    for filename in sorted(os.listdir(input_folder)):
        if filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp")):
            frame_num = os.path.splitext(filename)[0]
            input_path = os.path.join(input_folder, filename)
            txt_path = os.path.join(txt_folder, f"{frame_num}.txt")
            png_path = os.path.join(png_folder, f"{frame_num}.png")

            ascii_art = image_to_ascii(input_path, s)

            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(ascii_art)

            ascii_to_png(ascii_art, png_path, s)

            print(f"Processed {filename} -> {txt_path}, {png_path}")


if __name__ == "__main__":
    # Basic CLI run with defaults; tweak here or use the forthcoming web UI
    process_frames(input_folder, output_txt_folder, output_png_folder)

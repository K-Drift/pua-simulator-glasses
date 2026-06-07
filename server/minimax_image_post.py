#!/usr/bin/env python3
import argparse
import base64
import datetime as dt
import json
import mimetypes
import os
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE_IMAGE = Path("/Users/mi/Downloads/人像.jpg")
DEFAULT_OUTPUT_DIR = ROOT / "media" / "image_tests"

DEFAULT_PROMPT = (
    "Create a 2D anime pixel-art illustration based closely on the reference person. "
    "Preserve the person's recognizable facial features and likeness: young Asian man, short messy dark hair, "
    "similar face shape, similar eyes and nose, calm expression, single person. Do not turn him into a generic boy. "
    "The person must wear obvious black smart AI glasses, not ordinary glasses: black frame, transparent lenses, "
    "visible thick side module on the temple, tiny blue sensor light, small camera/sensor dot near one lens. "
    "Keep the glasses similar enough to the reference face shape but make the AI hardware details visible. "
    "Show the person sitting at a desk and looking at a computer screen. The monitor must be clearly visible in the "
    "foreground or side of the frame, keyboard and mouse on the desk, hands near keyboard, screen glow on the face. "
    "Style: Japanese anime character design plus pixel-game art direction, clean 2D cel shading, crisp line art, "
    "limited but warm color palette, readable facial details, subtle pixel-grid texture and small blocky highlights. "
    "The result should feel anime and pixel-inspired, but not heavily pixelated, not mosaic, not 8-bit blocky, "
    "not 3D render, not plastic, not photorealistic. "
    "No text, no subtitles, no watermark, no extra people."
)


class MiniMaxError(RuntimeError):
    pass


def load_env_file(env_path):
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def parse_args():
    parser = argparse.ArgumentParser(description="Local MiniMax image-generation test for the AI-glasses portrait.")
    parser.add_argument("--image", type=Path, default=DEFAULT_SOURCE_IMAGE)
    parser.add_argument("--style-image", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--model", default=os.environ.get("MINIMAX_IMAGE_MODEL", "image-01-live"))
    parser.add_argument("--n", type=int, default=3)
    parser.add_argument("--style-weight", type=float, default=0.5)
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--aspect-ratio", default="3:4")
    return parser.parse_args()


def read_api_key():
    api_key = os.environ.get("MINIMAX_API_KEY", "").strip()
    if not api_key:
        raise MiniMaxError("MINIMAX_API_KEY is not configured.")
    return api_key


def guess_mime(path):
    return mimetypes.guess_type(str(path))[0] or "image/jpeg"


def data_url_for_file(path):
    raw = path.read_bytes()
    return f"data:{guess_mime(path)};base64,{base64.b64encode(raw).decode('ascii')}"


def request_json(path, api_key, body):
    url = f"{os.environ.get('MINIMAX_PLATFORM_API_BASE', 'https://api.minimaxi.com').rstrip('/')}{path}"
    request = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise MiniMaxError(f"MiniMax HTTP {e.code}: {detail}") from e


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def sanitize_body(body):
    sanitized = dict(body)
    refs = []
    for ref in sanitized.get("subject_reference", []):
        item = dict(ref)
        value = item.get("image_file", "")
        item["image_file"] = f"{value[:40]}... ({len(value)} chars)"
        refs.append(item)
    sanitized["subject_reference"] = refs
    return sanitized


def decode_base64_image(value):
    if "," in value and value.lstrip().startswith("data:"):
        value = value.split(",", 1)[1]
    return base64.b64decode(value)


def save_images(response, run_dir, api_key):
    data = response.get("data") or {}
    paths = []
    for index, value in enumerate(data.get("image_base64") or [], start=1):
        path = run_dir / f"candidate_{index:02d}.jpg"
        path.write_bytes(decode_base64_image(value))
        paths.append(path)
    for index, url in enumerate(data.get("image_urls") or [], start=len(paths) + 1):
        path = run_dir / f"candidate_{index:02d}.jpg"
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
        with urllib.request.urlopen(request, timeout=180) as response_file:
            path.write_bytes(response_file.read())
        paths.append(path)
    return paths


def main():
    load_env_file(ROOT / ".env")
    args = parse_args()
    source_image = args.image.expanduser().resolve()
    if not source_image.exists():
        raise MiniMaxError(f"Image not found: {source_image}")
    if args.n < 1 or args.n > 9:
        raise MiniMaxError("--n must be between 1 and 9.")

    run_dir = args.output_dir.expanduser().resolve() / dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)

    subject_reference = [{"type": "character", "image_file": data_url_for_file(source_image)}]
    if args.style_image:
        style_image = args.style_image.expanduser().resolve()
        if not style_image.exists():
            raise MiniMaxError(f"Style image not found: {style_image}")
        subject_reference.append({"type": "character", "image_file": data_url_for_file(style_image)})

    body = {
        "model": args.model,
        "prompt": args.prompt,
        "subject_reference": subject_reference,
        "aspect_ratio": args.aspect_ratio,
        "response_format": "base64",
        "n": args.n,
        "prompt_optimizer": False,
        "aigc_watermark": False,
    }
    if args.model == "image-01-live":
        body["style"] = {"style_type": "漫画", "style_weight": args.style_weight}

    write_json(run_dir / "request.summary.json", sanitize_body(body))
    response = request_json("/v1/image_generation", read_api_key(), body)
    response_summary = dict(response)
    if "data" in response_summary:
        response_summary["data"] = {
            "image_base64_count": len((response.get("data") or {}).get("image_base64") or []),
            "image_urls": (response.get("data") or {}).get("image_urls") or [],
        }
    write_json(run_dir / "response.summary.json", response_summary)
    paths = save_images(response, run_dir, read_api_key())
    for path in paths:
        print(path)


if __name__ == "__main__":
    try:
        main()
    except MiniMaxError as e:
        print(f"error: {e}")
        raise SystemExit(1)

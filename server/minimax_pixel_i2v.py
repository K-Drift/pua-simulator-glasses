#!/usr/bin/env python3
import argparse
import base64
import datetime as dt
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE_IMAGE = Path("/Users/mi/Downloads/人像.jpg")
DEFAULT_OUTPUT_DIR = ROOT / "media" / "videos"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
VIDEO_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_I2I_IMAGE_BYTES = 10 * 1024 * 1024
MAX_I2V_IMAGE_BYTES = 20 * 1024 * 1024

FIRST_FRAME_PROMPT = (
    "Create a clearly cartoon 16-bit pixel art character based loosely on the reference portrait. "
    "Only preserve basic traits: young man, short dark messy hair, single person, upper body. "
    "Do not make it photorealistic. Use simplified facial features, chunky pixel blocks, hard edges, "
    "limited color palette, game sprite portrait style. "
    "The character must wear obvious black smart AI glasses: thick black frame, transparent lenses, "
    "small side module and tiny sensor light, clearly visible on the face. "
    "Scene: seated at a desk looking at a computer, office background simplified into pixel blocks. "
    "No text, no subtitles, no watermark, no extra people."
)

VIDEO_PROMPT = (
    "[固定] Animate this as an obvious cartoon pixel-art character, like a 16-bit game cutscene. "
    "Keep only the basic task features: young man with short dark hair, black smart AI glasses, "
    "sitting at a desk and looking at a computer. "
    "The black AI glasses must remain visible in every frame, with thick black frame and side module. "
    "Simple blink, small head turn toward the monitor, slight typing motion. "
    "Avoid photorealism, avoid cinematic realistic skin detail, keep chunky pixels and game-like shapes. "
    "Locked camera, medium close-up, no text, no subtitles, no watermark, no extra people."
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
    parser = argparse.ArgumentParser(
        description="Generate a 2-3s pixel-art portrait action video with black AI glasses via MiniMax."
    )
    parser.add_argument("--image", type=Path, default=DEFAULT_SOURCE_IMAGE, help="Portrait reference image.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Output directory.")
    parser.add_argument(
        "--target-seconds",
        type=float,
        default=6.0,
        help="Final length in seconds. Values shorter than --raw-duration are trimmed locally.",
    )
    parser.add_argument("--raw-duration", type=int, default=6, choices=(6, 10), help="MiniMax raw video duration.")
    parser.add_argument("--resolution", default="768P", choices=("512P", "720P", "768P", "1080P"))
    parser.add_argument("--video-model", default=os.environ.get("MINIMAX_VIDEO_MODEL", "MiniMax-Hailuo-2.3-Fast"))
    parser.add_argument("--image-model", default=os.environ.get("MINIMAX_IMAGE_MODEL", "image-01-live"))
    parser.add_argument("--first-frame-prompt", default=FIRST_FRAME_PROMPT)
    parser.add_argument("--video-prompt", default=VIDEO_PROMPT)
    parser.add_argument("--skip-first-frame-prep", action="store_true", help="Use the original image directly for I2V.")
    parser.add_argument("--no-local-pixelate", action="store_true", help="Do not pixelate the first frame locally.")
    parser.add_argument("--pixel-block-size", type=int, default=14, help="Pixel block size for local first-frame pixelation.")
    parser.add_argument("--no-output-pixelate", action="store_true", help="Do not pixelate the downloaded video locally.")
    parser.add_argument("--output-pixel-block-size", type=int, default=14, help="Pixel block size for output video pixelation.")
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--timeout", type=float, default=900.0)
    parser.add_argument("--dry-run", action="store_true", help="Print request summaries without calling MiniMax.")
    return parser.parse_args()


def read_api_key():
    api_key = os.environ.get("MINIMAX_API_KEY", "").strip()
    if not api_key:
        raise MiniMaxError("MINIMAX_API_KEY is not configured. Put it in backend/.env or export it in the shell.")
    return api_key


def platform_api_base():
    return os.environ.get("MINIMAX_PLATFORM_API_BASE", "https://api.minimaxi.com").rstrip("/")


def guess_mime(path):
    mime = mimetypes.guess_type(str(path))[0]
    if mime:
        return mime
    suffix = path.suffix.lower()
    if suffix in (".jpg", ".jpeg"):
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    return "application/octet-stream"


def data_url_for_file(path):
    raw = path.read_bytes()
    return f"data:{guess_mime(path)};base64,{base64.b64encode(raw).decode('ascii')}"


def decode_image_base64(value):
    if "," in value and value.lstrip().startswith("data:"):
        value = value.split(",", 1)[1]
    return base64.b64decode(value)


def image_suffix_from_bytes(raw):
    if raw.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return ".webp"
    return ".jpg"


def sips_dimensions(path):
    if not shutil.which("sips"):
        return None
    result = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    width = height = None
    for line in result.stdout.splitlines():
        line = line.strip()
        if line.startswith("pixelWidth:"):
            width = int(line.split(":", 1)[1].strip())
        elif line.startswith("pixelHeight:"):
            height = int(line.split(":", 1)[1].strip())
    if width and height:
        return width, height
    return None


def video_dimensions(path):
    if not shutil.which("ffprobe"):
        raise MiniMaxError("Video dimension detection requires ffprobe.")
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0",
            str(path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise MiniMaxError(f"ffprobe failed: {result.stderr.strip()}")
    parts = result.stdout.strip().split(",")
    if len(parts) != 2:
        raise MiniMaxError(f"Could not parse video dimensions: {result.stdout.strip()}")
    return int(parts[0]), int(parts[1])


def validate_image(path, *, for_first_frame_prep):
    if not path.exists():
        raise MiniMaxError(f"Image not found: {path}")
    suffix = path.suffix.lower()
    allowed = IMAGE_EXTENSIONS if for_first_frame_prep else VIDEO_IMAGE_EXTENSIONS
    if suffix not in allowed:
        raise MiniMaxError(f"Unsupported image type: {suffix}. Allowed: {', '.join(sorted(allowed))}")
    max_bytes = MAX_I2I_IMAGE_BYTES if for_first_frame_prep else MAX_I2V_IMAGE_BYTES
    size = path.stat().st_size
    if size >= max_bytes:
        raise MiniMaxError(f"Image is too large: {size} bytes. Limit: {max_bytes} bytes.")
    dimensions = sips_dimensions(path)
    if dimensions:
        width, height = dimensions
        if min(width, height) <= 300:
            raise MiniMaxError(f"Image short side must be >300px, got {width}x{height}.")
        ratio = width / height
        if ratio < 2 / 5 or ratio > 5 / 2:
            raise MiniMaxError(f"Image aspect ratio must be between 2:5 and 5:2, got {width}x{height}.")


def request_json(method, path, api_key, *, body=None, query=None, timeout=120):
    url = f"{platform_api_base()}{path}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"
    data = None
    headers = {"Authorization": f"Bearer {api_key}"}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise MiniMaxError(f"MiniMax HTTP {e.code}: {detail}") from e


def assert_success(response, context):
    base_resp = response.get("base_resp") or {}
    status_code = base_resp.get("status_code")
    if status_code not in (None, 0):
        status_msg = base_resp.get("status_msg", "")
        raise MiniMaxError(f"{context} failed: status_code={status_code}, status_msg={status_msg}")


def prepare_first_frame(args, api_key, source_image, run_dir):
    body = {
        "model": args.image_model,
        "prompt": args.first_frame_prompt,
        "aspect_ratio": "3:4",
        "subject_reference": [{"type": "character", "image_file": data_url_for_file(source_image)}],
        "response_format": "base64",
        "n": 1,
        "prompt_optimizer": False,
        "aigc_watermark": False,
    }
    if args.image_model == "image-01-live":
        body["style"] = {"style_type": "漫画", "style_weight": 1.0}
    write_json(run_dir / "first_frame_request.summary.json", request_summary(body))
    if args.dry_run:
        print(f"[dry-run] Would create pixel first frame with {args.image_model}.")
        return source_image

    response = request_json("POST", "/v1/image_generation", api_key, body=body)
    write_json(run_dir / "first_frame_response.json", response)
    assert_success(response, "Image generation")
    image_base64 = ((response.get("data") or {}).get("image_base64") or [None])[0]
    if not image_base64:
        image_url = ((response.get("data") or {}).get("image_urls") or [None])[0]
        if not image_url:
            raise MiniMaxError("Image generation succeeded but returned no image_base64 or image_urls.")
        first_frame_path = run_dir / "pixel_ai_glasses_first_frame.jpg"
        download_file(image_url, first_frame_path, api_key=None)
        return first_frame_path

    raw = decode_image_base64(image_base64)
    first_frame_path = run_dir / f"pixel_ai_glasses_first_frame{image_suffix_from_bytes(raw)}"
    first_frame_path.write_bytes(raw)
    return first_frame_path


def create_video_task(args, api_key, first_frame_image, run_dir):
    body = {
        "model": args.video_model,
        "first_frame_image": data_url_for_file(first_frame_image),
        "prompt": args.video_prompt,
        "prompt_optimizer": False,
        "fast_pretreatment": True,
        "duration": args.raw_duration,
        "resolution": args.resolution,
        "aigc_watermark": False,
    }
    write_json(run_dir / "video_generation_request.summary.json", request_summary(body))
    if args.dry_run:
        print(f"[dry-run] Would create video task with {args.video_model}, {args.raw_duration}s, {args.resolution}.")
        return None

    response = request_json("POST", "/v1/video_generation", api_key, body=body)
    write_json(run_dir / "video_generation_response.json", response)
    assert_success(response, "Video generation task creation")
    task_id = response.get("task_id")
    if not task_id:
        raise MiniMaxError(f"MiniMax response did not include task_id: {response}")
    return task_id


def poll_video_task(args, api_key, task_id, run_dir):
    started = time.monotonic()
    snapshots = []
    while True:
        response = request_json(
            "GET",
            "/v1/query/video_generation",
            api_key,
            query={"task_id": task_id},
            timeout=60,
        )
        snapshots.append(response)
        write_json(run_dir / "video_generation_poll.json", snapshots)
        assert_success(response, "Video task query")
        status = response.get("status")
        print(f"[poll] task_id={task_id} status={status}")
        if status == "Success":
            file_id = response.get("file_id")
            if not file_id:
                raise MiniMaxError(f"Task succeeded but no file_id was returned: {response}")
            return file_id
        if status == "Fail":
            raise MiniMaxError(f"Video task failed: {response}")
        if time.monotonic() - started > args.timeout:
            raise MiniMaxError(f"Timed out after {args.timeout}s waiting for task {task_id}")
        time.sleep(args.poll_interval)


def retrieve_download_url(api_key, file_id, run_dir):
    response = request_json(
        "GET",
        "/v1/files/retrieve",
        api_key,
        query={"file_id": file_id},
        timeout=60,
    )
    write_json(run_dir / "file_retrieve_response.json", response)
    assert_success(response, "File retrieve")
    download_url = ((response.get("file") or {}).get("download_url") or "").strip()
    if not download_url:
        raise MiniMaxError(f"File retrieve succeeded but returned no download_url: {response}")
    return download_url


def download_file(url, output_path, api_key=None):
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=180) as response:
        output_path.write_bytes(response.read())


def trim_video(raw_video, output_video, seconds):
    if not shutil.which("ffmpeg"):
        print("[warn] ffmpeg not found; leaving raw 6s video untrimmed.", file=sys.stderr)
        return False
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(raw_video),
        "-t",
        str(seconds),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-an",
        str(output_video),
    ]
    subprocess.run(command, check=True)
    return True


def pixelate_image(input_path, output_path, block_size):
    dimensions = sips_dimensions(input_path)
    if not dimensions:
        raise MiniMaxError("Cannot pixelate first frame because image dimensions could not be read.")
    if block_size < 2:
        raise MiniMaxError("--pixel-block-size must be at least 2.")
    width, height = dimensions
    low_width = max(1, width // block_size)
    low_height = max(1, height // block_size)
    if shutil.which("ffmpeg"):
        command = [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-vf",
            f"scale={low_width}:{low_height}:flags=neighbor,scale={width}:{height}:flags=neighbor",
            "-frames:v",
            "1",
            str(output_path),
        ]
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return output_path
    try:
        from PIL import Image
    except ImportError as e:
        raise MiniMaxError("Pixelation requires ffmpeg or Pillow.") from e
    with Image.open(input_path) as image:
        image = image.convert("RGB")
        image = image.resize((low_width, low_height), Image.Resampling.NEAREST)
        image = image.resize((width, height), Image.Resampling.NEAREST)
        image.save(output_path)
    return output_path


def pixelate_video(input_path, output_path, block_size):
    if block_size < 2:
        raise MiniMaxError("--output-pixel-block-size must be at least 2.")
    if not shutil.which("ffmpeg"):
        raise MiniMaxError("Output video pixelation requires ffmpeg.")
    width, height = video_dimensions(input_path)
    low_width = max(1, width // block_size)
    low_height = max(1, height // block_size)
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vf",
        (
            f"scale={low_width}:{low_height}:flags=neighbor,"
            "elbg=codebook_length=48:nb_steps=1,"
            "eq=saturation=1.25:contrast=1.12,"
            f"scale={width}:{height}:flags=neighbor"
        ),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-an",
        str(output_path),
    ]
    subprocess.run(command, check=True)
    return output_path


def request_summary(body):
    summary = dict(body)
    for key in ("first_frame_image",):
        if key in summary:
            value = summary[key]
            summary[key] = f"{value[:40]}... ({len(value)} chars)"
    if "subject_reference" in summary:
        refs = []
        for item in summary["subject_reference"]:
            item_summary = dict(item)
            value = item_summary.get("image_file", "")
            item_summary["image_file"] = f"{value[:40]}... ({len(value)} chars)"
            refs.append(item_summary)
        summary["subject_reference"] = refs
    return summary


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    load_env_file(ROOT / ".env")
    args = parse_args()
    if args.target_seconds <= 0 or args.target_seconds > args.raw_duration:
        raise MiniMaxError("--target-seconds must be greater than 0 and no longer than --raw-duration.")
    source_image = args.image.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = output_dir / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    validate_image(source_image, for_first_frame_prep=not args.skip_first_frame_prep)
    api_key = None if args.dry_run else read_api_key()

    write_json(
        run_dir / "run_config.json",
        {
            "source_image": str(source_image),
            "output_dir": str(run_dir),
            "target_seconds": args.target_seconds,
            "raw_duration": args.raw_duration,
            "resolution": args.resolution,
            "video_model": args.video_model,
            "image_model": args.image_model,
            "skip_first_frame_prep": args.skip_first_frame_prep,
            "local_pixelate": not args.no_local_pixelate,
            "pixel_block_size": args.pixel_block_size,
            "output_pixelate": not args.no_output_pixelate,
            "output_pixel_block_size": args.output_pixel_block_size,
            "platform_api_base": platform_api_base(),
        },
    )

    if args.skip_first_frame_prep:
        first_frame_image = source_image
    else:
        first_frame_image = prepare_first_frame(args, api_key, source_image, run_dir)
        validate_image(first_frame_image, for_first_frame_prep=False)
    if not args.no_local_pixelate:
        pixelated_path = run_dir / "pixelated_first_frame.jpg"
        first_frame_image = pixelate_image(first_frame_image, pixelated_path, args.pixel_block_size)
        validate_image(first_frame_image, for_first_frame_prep=False)

    task_id = create_video_task(args, api_key, first_frame_image, run_dir)
    if args.dry_run:
        print(f"[dry-run] Request summaries written to {run_dir}")
        return

    file_id = poll_video_task(args, api_key, task_id, run_dir)
    download_url = retrieve_download_url(api_key, file_id, run_dir)
    raw_video = run_dir / "raw_6s.mp4"
    download_file(download_url, raw_video)
    processed_video = raw_video
    if args.target_seconds < args.raw_duration:
        trimmed_video = run_dir / f"trimmed_{args.target_seconds:g}s.mp4"
        trim_video(raw_video, trimmed_video, args.target_seconds)
        processed_video = trimmed_video
    if not args.no_output_pixelate:
        final_video = run_dir / f"pixel_ai_glasses_{args.target_seconds:g}s.mp4"
        processed_video = pixelate_video(processed_video, final_video, args.output_pixel_block_size)

    print(f"task_id={task_id}")
    print(f"file_id={file_id}")
    print(f"first_frame={first_frame_image}")
    print(f"raw_video={raw_video}")
    print(f"final_video={processed_video}")


if __name__ == "__main__":
    try:
        main()
    except MiniMaxError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
import argparse
import base64
import datetime as dt
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE_IMAGE = Path("/Users/mi/Downloads/图片帧最新.jpg")
DEFAULT_OUTPUT_DIR = ROOT / "media" / "qiniu_image_tests"
DEFAULT_API_BASE = "https://api.qnaigc.com/v1"
DEFAULT_PROMPT = (
    "基于参考图生成一张横图动漫像素风办公室插画。保持参考图的整体比例、构图和氛围："
    "夜晚窗景、暖色台灯、暗色办公室、木质桌面、键盘、鼠标、马克杯、右前景大电脑显示器。"
    "人物是年轻亚洲男性，短而略乱的黑发，坐在桌前，三分之二侧脸朝向电脑屏幕，"
    "明显正在看电脑，不要看镜头。人物必须佩戴明显的黑色智能 AI 眼镜：黑色镜框、透明镜片、"
    "镜腿侧边有较厚的智能模块、一个小蓝色传感器灯、镜片旁有小摄像头或传感器点。"
    "画风是复古动漫像素插画，粗黑轮廓，暖棕和深蓝配色，适度像素纹理，但不要过度马赛克，"
    "脸部仍然清晰可读。不要 3D，不要写实照片，不要文字，不要水印，不要多余人物。"
)
DEFAULT_NEGATIVE_PROMPT = (
    "看镜头,正脸自拍,普通眼镜,没有电脑,没有显示器,过度马赛克,脸部糊掉,3D渲染,写实照片,"
    "低质量,变形,多个人,文字,字幕,水印"
)


class QiniuError(RuntimeError):
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
    parser = argparse.ArgumentParser(description="Local Qiniu Kling image-to-image test.")
    parser.add_argument("--image", type=Path, default=DEFAULT_SOURCE_IMAGE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--api-base", default=os.environ.get("QNAIGC_API_BASE", DEFAULT_API_BASE))
    parser.add_argument("--model", default=os.environ.get("QNAIGC_IMAGE_MODEL", "kling-v2"))
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--negative-prompt", default=DEFAULT_NEGATIVE_PROMPT)
    parser.add_argument("--aspect-ratio", default="4:3")
    parser.add_argument("--n", type=int, default=3)
    parser.add_argument("--poll-interval", type=float, default=3.0)
    parser.add_argument("--timeout", type=float, default=300.0)
    return parser.parse_args()


def read_api_key():
    api_key = os.environ.get("QNAIGC_API_KEY") or os.environ.get("QINIU_API_KEY") or ""
    api_key = api_key.strip()
    if not api_key:
        raise QiniuError("QNAIGC_API_KEY is not configured.")
    return api_key


def image_base64(path):
    return base64.b64encode(path.read_bytes()).decode("ascii")


def request_json(method, url, api_key, body=None, timeout=120):
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
        raise QiniuError(f"Qiniu HTTP {e.code}: {detail}") from e


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def redacted_body(body):
    result = dict(body)
    if "image" in result:
        result["image"] = f"{result['image'][:24]}... ({len(result['image'])} chars)"
    return result


def create_task(args, api_key, run_dir):
    source_image = args.image.expanduser().resolve()
    if not source_image.exists():
        raise QiniuError(f"Image not found: {source_image}")
    if source_image.stat().st_size > 10 * 1024 * 1024:
        raise QiniuError("Qiniu image input must be <= 10MB.")
    body = {
        "model": args.model,
        "image": image_base64(source_image),
        "prompt": args.prompt,
        "negative_prompt": args.negative_prompt,
        "aspect_ratio": args.aspect_ratio,
        "n": args.n,
    }
    write_json(run_dir / "request.summary.json", redacted_body(body))
    response = request_json("POST", f"{args.api_base.rstrip('/')}/images/generations", api_key, body=body)
    write_json(run_dir / "create_response.json", response)
    task_id = response.get("task_id")
    if not task_id:
        raise QiniuError(f"Create response did not include task_id: {response}")
    return task_id


def poll_task(args, api_key, task_id, run_dir):
    started = time.monotonic()
    snapshots = []
    url = f"{args.api_base.rstrip('/')}/images/tasks/{task_id}"
    while True:
        response = request_json("GET", url, api_key, timeout=60)
        snapshots.append(response)
        write_json(run_dir / "poll_response.json", snapshots)
        status = response.get("status")
        print(f"[poll] task_id={task_id} status={status} message={response.get('status_message', '')}")
        if status == "succeed":
            return response
        if status == "failed":
            raise QiniuError(f"Task failed: {response.get('status_message', response)}")
        if time.monotonic() - started > args.timeout:
            raise QiniuError(f"Timed out waiting for task {task_id}")
        time.sleep(args.poll_interval)


def download_results(response, run_dir):
    paths = []
    for item in response.get("data") or []:
        index = item.get("index", len(paths))
        url = item.get("url")
        if not url:
            continue
        suffix = ".png"
        path = run_dir / f"candidate_{int(index) + 1:02d}{suffix}"
        with urllib.request.urlopen(url, timeout=180) as image_response:
            path.write_bytes(image_response.read())
        paths.append(path)
    if not paths:
        raise QiniuError(f"No image URLs found in response: {response}")
    return paths


def main():
    load_env_file(ROOT / ".env")
    args = parse_args()
    if args.n < 1 or args.n > 10:
        raise QiniuError("--n must be between 1 and 10.")
    run_dir = args.output_dir.expanduser().resolve() / dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    api_key = read_api_key()
    task_id = create_task(args, api_key, run_dir)
    response = poll_task(args, api_key, task_id, run_dir)
    write_json(run_dir / "final_response.json", response)
    paths = download_results(response, run_dir)
    for path in paths:
        print(path)


if __name__ == "__main__":
    try:
        main()
    except QiniuError as e:
        print(f"error: {e}")
        raise SystemExit(1)

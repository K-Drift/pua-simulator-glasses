#!/usr/bin/env python
import base64
import copy
import datetime as dt
import hashlib
import hmac
import html
import io
import json
import mimetypes
import os
import queue
import random
import re
import struct
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from PIL import Image, ImageOps
except Exception:
    Image = None
    ImageOps = None


ROOT = Path(__file__).resolve().parent


def load_env_file(env_path):
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().lstrip("\ufeff")
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_env_file(ROOT / ".env")

CONFIG_PATH = Path(os.environ.get("VOLC_SCENE_CONFIG", ROOT / "config" / "scene.json"))
IMAGE_ROOT = Path(os.environ.get("ROKID_IMAGE_ROOT", ROOT / "media" / "images"))
SCREENSHOT_ROOT = Path(os.environ.get("ROKID_SCREENSHOT_ROOT", ROOT / "media" / "screenshots"))
PERSONAL_IMAGE_ROOT = Path(os.environ.get("ROKID_PERSONAL_IMAGE_ROOT", ROOT / "media" / "personal_images"))
GENERATED_IMAGE_ROOT = Path(os.environ.get("ROKID_GENERATED_IMAGE_ROOT", ROOT / "media" / "generated_images"))
ANALYSIS_ROOT = Path(os.environ.get("ROKID_ANALYSIS_ROOT", ROOT / "media" / "analysis"))
ANALYSIS_IMAGE_ROOT = Path(os.environ.get("ROKID_ANALYSIS_IMAGE_ROOT", ROOT / "media" / "analysis_images"))
USER_DATA_ROOT = Path(os.environ.get("ROKID_USER_DATA_ROOT", ROOT / "media" / "users"))
KPI_STORE_PATH = Path(os.environ.get("ROKID_KPI_STORE_PATH", USER_DATA_ROOT / "kpi.json"))
GROUP_CHAT_STORE_PATH = Path(os.environ.get("ROKID_GROUP_CHAT_STORE_PATH", USER_DATA_ROOT / "group_chat.json"))
TTS_VOICE_STORE_PATH = Path(os.environ.get("ROKID_TTS_VOICE_STORE_PATH", USER_DATA_ROOT / "tts_voice.json"))
DEFAULT_CONTROL_HTML_PATH = ROOT / "control.html"
if not DEFAULT_CONTROL_HTML_PATH.exists():
    DEFAULT_CONTROL_HTML_PATH = ROOT.parent / "control.html"
CONTROL_HTML_PATH = Path(os.environ.get("ROKID_CONTROL_HTML_PATH", DEFAULT_CONTROL_HTML_PATH))
KPI_GLOBAL_KEY = "global"
PORT = int(os.environ.get("PORT", os.environ.get("VOLC_RTC_BACKEND_PORT", "18091")))

VOLC_HOST = os.environ.get("VOLC_OPENAPI_HOST", "rtc.volcengineapi.com")
VOLC_REGION = os.environ.get("VOLC_OPENAPI_REGION", "cn-north-1")
VOLC_SERVICE = os.environ.get("VOLC_OPENAPI_SERVICE", "rtc")
VOLC_VERSION = os.environ.get("VOLC_VOICE_CHAT_VERSION", "2025-06-01")
TOKEN_TTL_SECONDS = int(os.environ.get("VOLC_RTC_TOKEN_TTL_SECONDS", str(24 * 3600)))

PRIV_PUBLISH_STREAM = 0
PRIV_PUBLISH_AUDIO_STREAM = 1
PRIV_PUBLISH_VIDEO_STREAM = 2
PRIV_PUBLISH_DATA_STREAM = 3
PRIV_SUBSCRIBE_STREAM = 4

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
CATEGORY_PATTERN = re.compile(r"^[\w\u4e00-\u9fff -]{1,64}$")
USER_ID_PATTERN = re.compile(r"^[\w.@-]{1,64}$")
GROUP_ID_PATTERN = re.compile(r"^[\w.@-]{1,64}$")
MAX_IMAGE_UPLOAD_BYTES = int(os.environ.get("ROKID_MAX_IMAGE_UPLOAD_BYTES", str(15 * 1024 * 1024)))
MAX_SCREENSHOT_UPLOAD_BYTES = int(os.environ.get("ROKID_MAX_SCREENSHOT_UPLOAD_BYTES", str(10 * 1024 * 1024)))
MAX_PERSONAL_IMAGE_UPLOAD_BYTES = int(os.environ.get("ROKID_MAX_PERSONAL_IMAGE_UPLOAD_BYTES", str(15 * 1024 * 1024)))
MAX_PERSONAL_AVATAR_BYTES = int(os.environ.get("ROKID_MAX_PERSONAL_AVATAR_BYTES", str(100 * 1024)))
PERSONAL_AVATAR_FILENAME = os.environ.get("ROKID_PERSONAL_AVATAR_FILENAME", "avatar.jpg")
ANALYSIS_IMAGE_MAX_WIDTH = int(os.environ.get("ROKID_ANALYSIS_IMAGE_MAX_WIDTH", "480"))
ANALYSIS_IMAGE_MAX_HEIGHT = int(os.environ.get("ROKID_ANALYSIS_IMAGE_MAX_HEIGHT", "480"))
ANALYSIS_IMAGE_JPEG_QUALITY = int(os.environ.get("ROKID_ANALYSIS_IMAGE_JPEG_QUALITY", "85"))
DEFAULT_IMAGE_CATEGORY = os.environ.get("ROKID_DEFAULT_IMAGE_CATEGORY", "rokid")
GLASSES_CAMERA_ENABLED = os.environ.get("ROKID_GLASSES_CAMERA_ENABLED", "1").lower() in {"1", "true", "yes", "y", "on"}
# 演示用兜底 key 已移除，仅从环境变量 / .env 读取（见 .env.example）。
DEMO_IMAGE_LLM_API_KEY = os.environ.get("DEMO_IMAGE_LLM_API_KEY", "")
IMAGE_LLM_PROVIDER = os.environ.get("IMAGE_LLM_PROVIDER", "zhizengzeng")
IMAGE_LLM_MESSAGES_URL = (
    os.environ.get("IMAGE_LLM_MESSAGES_URL")
    or os.environ.get("ZHIZENGZENG_MESSAGES_URL")
    or "https://api.zhizengzeng.com/anthropic/v1/messages"
)
IMAGE_LLM_API_KEY = (
    os.environ.get("IMAGE_LLM_API_KEY")
    or os.environ.get("ZHIZENGZENG_API_KEY")
    or os.environ.get("MINIMAX_API_KEY")
    or DEMO_IMAGE_LLM_API_KEY
)
IMAGE_LLM_MODEL = os.environ.get("IMAGE_LLM_MODEL") or os.environ.get("ZHIZENGZENG_MODEL") or "mimo-v2.5"
IMAGE_LLM_TIMEOUT_SECONDS = int(os.environ.get("IMAGE_LLM_TIMEOUT_SECONDS", os.environ.get("MINIMAX_TIMEOUT_SECONDS", "45")))
TOKENDANCE_IMAGE_URL = os.environ.get("TOKENDANCE_IMAGE_URL", "https://tokendance.space/gateway/v1/images/generations")
TOKENDANCE_IMAGE_API_KEY = os.environ.get("TOKENDANCE_IMAGE_API_KEY", "")
TOKENDANCE_IMAGE_MODEL = os.environ.get("TOKENDANCE_IMAGE_MODEL", "seedream-5.0-lite")
TOKENDANCE_IMAGE_SIZE = os.environ.get("TOKENDANCE_IMAGE_SIZE", "1024x1024")
TOKENDANCE_IMAGE_TIMEOUT_SECONDS = int(os.environ.get("TOKENDANCE_IMAGE_TIMEOUT_SECONDS", "90"))
TOKENDANCE_DEFAULT_PROMPT = os.environ.get(
    "TOKENDANCE_DEFAULT_PROMPT",
    "将上传图片中的人物转换为卡通像素风格头像或半身像，尽量保留人物的脸型、发型、五官、表情、"
    "姿态和整体辨识度；风格为可爱的 2D cartoon pixel art，清晰、干净、有游戏像素质感，"
    "不要过度马赛克，不要改变人物身份，不要添加文字、水印或无关人物。",
)
TRANSITION_TTS_ENABLED = os.environ.get("ROKID_TRANSITION_TTS_ENABLED", "1").lower() not in {"0", "false", "no", "off"}
TRANSITION_TTS_DEVICE_ID = os.environ.get("ROKID_TRANSITION_TTS_DEVICE_ID", "rokid-glasses-001")
TTS_VOICE_NAME_TO_TYPE = {
    "董明珠": "S_LoL68Oa42",
    "刘强东": "S_MoL68Oa42",
    "雷军": "S_NoL68Oa42",
    "马云": "S_OoL68Oa42",
}
TTS_VOICE_TYPE_TO_NAME = {value: key for key, value in TTS_VOICE_NAME_TO_TYPE.items()}
TTS_VOICE_SWITCH_ALIAS = {
    "董明珠": "懂小姐",
    "刘强东": "东东强",
    "雷军": "雷布斯",
    "马云": "牛马云",
}
DEFAULT_TTS_VOICE_NAME = os.environ.get("ROKID_TTS_VOICE_NAME", "马云")
ONBOARDING_SCENARIOS = {"onboarding", "onboarding_training", "entry_training"}
ONBOARDING_WELCOME_MESSAGE = "简单介绍一下你的情况，你的短期目标和长期目标是什么？"
ONBOARDING_SYSTEM_PROMPT = (
    "你是马云，公司老板，你正在帮助新入职的同事梳理他的短期目标和长期目标，"
    "请引导用户向目标制定方向进行发言。\n"
    "1.根据情况融入你的日常金句，包括但不限于\n"
    "- 我对钱没有兴趣，我从来没碰过钱。\n"
    "- 今天很残酷，明天更残酷，后天很美好。\n"
    "- 能够996是一种巨大的福气。\n"
    "- 梦想还是要有的，万一实现了呢。\n"
    "- 如果你今天还只盯着钱，说明你的格局还没有真正打开。\n"
    "你可以根据实际情况自行生成。\n"
    "2.使用PUA的语气。"
)
KPI_FIX_SCENARIOS = {"kpi_fix", "kpi-fix", "boss_fix", "boss_talk"}
KPI_FIX_WELCOME_MESSAGE = "什么事，你说？"
ONBOARDING_LLM_CONFIG = {
    "Mode": "CustomLLM",
    "Url": "https://www.yhaox.top:18093/voicechat/kpi-create",
    "APIKey": "kpi_q25niAnyD_EYC9LtdhxNFytUlOJWWxC4",
    "ModelName": "CustomLLM",
    "SystemMessages": [ONBOARDING_SYSTEM_PROMPT],
}
KPI_FIX_LLM_CONFIG = {
    "Mode": "CustomLLM",
    "Url": "https://www.yhaox.top:18093/voicechat/kpi-fix",
    "APIKey": "kpi_q25niAnyD_EYC9LtdhxNFytUlOJWWxC4",
    "ModelName": "CustomLLM",
    "SystemMessages": [ONBOARDING_SYSTEM_PROMPT],
}
GROUP_CHAT_MAX_MESSAGES = int(os.environ.get("ROKID_GROUP_CHAT_MAX_MESSAGES", "10"))
GROUP_CHAT_DEFAULT_ID = os.environ.get("ROKID_GROUP_CHAT_DEFAULT_ID", "work")
GROUP_CHAT_WORK_SCENES = {"看电脑", "写东西"}
GROUP_CHAT_CRITIC_SCENES = {"看手机", "和朋友聊天"}
SCENE_LABELS = [
    "看电脑",
    "看手机",
    "摸鱼",
    "和朋友聊天",
    "写东西",
    "吃喝",
    "一个人的默认",
]
SCENE_LABEL_SET = set(SCENE_LABELS)
DEVICE_ID_PATTERN = re.compile(r"^[\w.-]{1,64}$")
SSE_CLIENTS = {}
SSE_CLIENTS_LOCK = threading.Lock()
TRANSITION_TTS_LOCK = threading.Lock()
KPI_STORE_LOCK = threading.Lock()
GROUP_CHAT_STORE_LOCK = threading.Lock()
TTS_VOICE_STORE_LOCK = threading.Lock()


class ConfigError(Exception):
    pass


class BadRequest(Exception):
    pass


def load_dotenv():
    load_env_file(ROOT / ".env")


def load_scene():
    if not CONFIG_PATH.exists():
        raise ConfigError(f"scene config not found: {CONFIG_PATH}")
    with CONFIG_PATH.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def env_or_config(env_name, config, key, default=""):
    return os.environ.get(env_name) or config.get(key) or default


def get_configs(scene):
    account = scene.get("AccountConfig") or {}
    rtc = scene.get("RTCConfig") or {}
    app_id = env_or_config("VOLC_RTC_APP_ID", rtc, "AppId")
    app_key = env_or_config("VOLC_RTC_APP_KEY", rtc, "AppKey")
    access_key_id = env_or_config("VOLC_ACCESS_KEY_ID", account, "accessKeyId")
    secret_key = env_or_config("VOLC_SECRET_ACCESS_KEY", account, "secretKey")
    return {
        "app_id": app_id,
        "app_key": app_key,
        "access_key_id": access_key_id,
        "secret_key": secret_key,
        "rtc": rtc,
        "account": account,
    }


def require_value(value, name):
    if not value:
        raise ConfigError(f"{name} is required")
    return value


def clean_category(value):
    category = str(value or "").strip()
    if not category:
        raise BadRequest("category is required")
    if not CATEGORY_PATTERN.match(category):
        raise BadRequest("category may only contain letters, numbers, Chinese chars, spaces, _ and -")
    if "/" in category or "\\" in category or ".." in category:
        raise BadRequest("invalid category")
    return category


def clean_image_name(value):
    name = str(value or "").strip()
    if not name:
        raise BadRequest("name is required")
    if "/" in name or "\\" in name or name != Path(name).name:
        raise BadRequest("invalid image name")
    suffix = Path(name).suffix.lower()
    if suffix not in IMAGE_EXTENSIONS:
        raise BadRequest("unsupported image type")
    return name


def clean_device_id(value):
    device_id = str(value or "rokid-glasses-001").strip()
    if not DEVICE_ID_PATTERN.match(device_id):
        raise BadRequest("invalid deviceId")
    return device_id


def clean_user_id(value):
    user_id = str(value or "default").strip()
    if not USER_ID_PATTERN.match(user_id):
        raise BadRequest("invalid userId")
    return user_id


def clean_group_id(value):
    group_id = str(value or GROUP_CHAT_DEFAULT_ID).strip()
    if not GROUP_ID_PATTERN.match(group_id):
        raise BadRequest("invalid groupId")
    return group_id


def first_non_empty(*values):
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def read_kpi_store():
    USER_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    if not KPI_STORE_PATH.exists():
        return {}
    try:
        with KPI_STORE_PATH.open("r", encoding="utf-8-sig") as f:
            payload = json.load(f)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def write_kpi_store(store):
    USER_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    tmp_path = KPI_STORE_PATH.with_suffix(f".{uuid.uuid4().hex}.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)
    tmp_path.replace(KPI_STORE_PATH)


def read_group_chat_store():
    USER_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    if not GROUP_CHAT_STORE_PATH.exists():
        return {}
    try:
        with GROUP_CHAT_STORE_PATH.open("r", encoding="utf-8-sig") as f:
            payload = json.load(f)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def write_group_chat_store(store):
    USER_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    tmp_path = GROUP_CHAT_STORE_PATH.with_suffix(f".{uuid.uuid4().hex}.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)
    tmp_path.replace(GROUP_CHAT_STORE_PATH)


def normalize_tts_voice(value):
    voice = str(value or "").strip()
    if not voice:
        voice = DEFAULT_TTS_VOICE_NAME
    if voice in TTS_VOICE_NAME_TO_TYPE:
        return voice, TTS_VOICE_NAME_TO_TYPE[voice]
    if voice in TTS_VOICE_TYPE_TO_NAME:
        return TTS_VOICE_TYPE_TO_NAME[voice], voice
    raise BadRequest("invalid voice, allowed: 雷军, 刘强东, 马云, 董明珠")


def read_tts_voice_store():
    USER_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    if not TTS_VOICE_STORE_PATH.exists():
        return {}
    try:
        with TTS_VOICE_STORE_PATH.open("r", encoding="utf-8-sig") as f:
            payload = json.load(f)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def write_tts_voice_store(store):
    USER_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    tmp_path = TTS_VOICE_STORE_PATH.with_suffix(f".{uuid.uuid4().hex}.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)
    tmp_path.replace(TTS_VOICE_STORE_PATH)


def tts_voice_response(name, voice_type, updated_at=None):
    return {
        "ok": True,
        "voice": name,
        "voiceName": name,
        "voiceType": voice_type,
        "updatedAtIso": updated_at,
        "allowed": [
            {"voice": name, "voiceName": name, "voiceType": voice_type}
            for name, voice_type in TTS_VOICE_NAME_TO_TYPE.items()
        ],
    }


def get_tts_voice():
    with TTS_VOICE_STORE_LOCK:
        store = read_tts_voice_store()
    try:
        name, voice_type = normalize_tts_voice(
            store.get("voice") or store.get("voiceName") or store.get("voiceType")
        )
    except BadRequest:
        name, voice_type = normalize_tts_voice(DEFAULT_TTS_VOICE_NAME)
    return tts_voice_response(name, voice_type, store.get("updatedAtIso"))


def set_tts_voice(body=None, query=None):
    body = body if isinstance(body, dict) else {}
    query = query if isinstance(query, dict) else {}
    target_device_id = clean_device_id(
        body.get("deviceId")
        or body.get("targetDeviceId")
        or query.get("deviceId")
        or query.get("targetDeviceId")
        or TRANSITION_TTS_DEVICE_ID
    )
    raw_voice = (
        body.get("voice")
        or body.get("voiceName")
        or body.get("voiceType")
        or body.get("voice_type")
        or body.get("speaker")
        or body.get("speakerName")
        or query.get("voice")
        or query.get("voiceName")
        or query.get("voiceType")
        or query.get("voice_type")
        or query.get("speaker")
        or query.get("speakerName")
    )
    name, voice_type = normalize_tts_voice(raw_voice)
    record = {
        "voice": name,
        "voiceName": name,
        "voiceType": voice_type,
        "updatedAtIso": now_iso(),
    }
    with TTS_VOICE_STORE_LOCK:
        previous_store = read_tts_voice_store()
        try:
            previous_name, previous_voice_type = normalize_tts_voice(
                previous_store.get("voice")
                or previous_store.get("voiceName")
                or previous_store.get("voiceType")
            )
        except BadRequest:
            previous_name, previous_voice_type = normalize_tts_voice(DEFAULT_TTS_VOICE_NAME)
        write_tts_voice_store(record)
    response = tts_voice_response(name, voice_type, record["updatedAtIso"])
    response["changed"] = previous_voice_type != voice_type
    response["previous"] = {
        "voice": previous_name,
        "voiceName": previous_name,
        "voiceType": previous_voice_type,
    }
    if response["changed"]:
        response["announcement"] = send_tts_voice_switch_announcement(target_device_id, name, voice_type)
    return response


def send_tts_voice_switch_announcement(device_id, voice_name, voice_type):
    alias = TTS_VOICE_SWITCH_ALIAS.get(voice_name, voice_name)
    text = f"我是{alias}"
    return send_glasses_command({
        "type": "tts",
        "deviceId": device_id,
        "text": text,
        "voice": voice_name,
        "voiceName": voice_name,
        "voiceType": voice_type,
        "source": "tts_voice_switch",
    })


def tts_voice_from_payload(payload):
    explicit_voice = first_non_empty(
        payload.get("voice"),
        payload.get("voiceName"),
        payload.get("voiceType"),
        payload.get("voice_type"),
        payload.get("speaker"),
        payload.get("speakerName"),
    )
    if explicit_voice:
        return normalize_tts_voice(explicit_voice)
    current = get_tts_voice()
    return current["voiceName"], current["voiceType"]


def apply_tts_voice(payload):
    payload = dict(payload or {})
    name, voice_type = tts_voice_from_payload(payload)
    payload["voice"] = name
    payload["voiceName"] = name
    payload["speaker"] = name
    payload["voiceType"] = voice_type
    payload["voice_type"] = voice_type
    return payload


def group_chat_avatar_url(base_url, nickname):
    params = urllib.parse.urlencode({"name": nickname})
    return f"{base_url}/group-chat/avatar?{params}"


def list_group_chat_messages(group_id):
    group_id = clean_group_id(group_id)
    with GROUP_CHAT_STORE_LOCK:
        store = read_group_chat_store()
    items = store.get(group_id, [])
    if not isinstance(items, list):
        items = []
    items = items[-GROUP_CHAT_MAX_MESSAGES:]
    return {
        "ok": True,
        "groupId": group_id,
        "maxCount": GROUP_CHAT_MAX_MESSAGES,
        "count": len(items),
        "items": items,
    }


def append_group_chat_message(group_id, message):
    group_id = clean_group_id(group_id)
    item = dict(message or {})
    item.setdefault("id", uuid.uuid4().hex)
    item.setdefault("createdAtIso", now_iso())
    with GROUP_CHAT_STORE_LOCK:
        store = read_group_chat_store()
        items = store.get(group_id, [])
        if not isinstance(items, list):
            items = []
        items.append(item)
        store[group_id] = items[-GROUP_CHAT_MAX_MESSAGES:]
        write_group_chat_store(store)
        count = len(store[group_id])
    return {
        "ok": True,
        "groupId": group_id,
        "count": count,
        "item": item,
    }


def append_group_chat_messages(group_id, messages):
    group_id = clean_group_id(group_id)
    now = now_iso()
    items_to_add = []
    for message in messages:
        item = dict(message or {})
        item.setdefault("id", uuid.uuid4().hex)
        item.setdefault("createdAtIso", now)
        items_to_add.append(item)
    with GROUP_CHAT_STORE_LOCK:
        store = read_group_chat_store()
        items = store.get(group_id, [])
        if not isinstance(items, list):
            items = []
        items.extend(items_to_add)
        store[group_id] = items[-GROUP_CHAT_MAX_MESSAGES:]
        write_group_chat_store(store)
        count = len(store[group_id])
    return {
        "ok": True,
        "groupId": group_id,
        "count": count,
        "items": items_to_add,
    }


def category_dir(category, create=False):
    IMAGE_ROOT.mkdir(parents=True, exist_ok=True)
    root = IMAGE_ROOT.resolve()
    path = (root / category).resolve()
    try:
        path.relative_to(root)
    except ValueError as e:
        raise BadRequest("invalid category path") from e
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def image_file_path(category, name):
    path = (category_dir(category, create=False) / name).resolve()
    try:
        path.relative_to(IMAGE_ROOT.resolve())
    except ValueError as e:
        raise BadRequest("invalid image path") from e
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(name)
    return path


def analysis_image_dir(category, create=False):
    ANALYSIS_IMAGE_ROOT.mkdir(parents=True, exist_ok=True)
    root = ANALYSIS_IMAGE_ROOT.resolve()
    path = (root / category).resolve()
    try:
        path.relative_to(root)
    except ValueError as e:
        raise BadRequest("invalid analysis image path") from e
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def analysis_image_name(image_name):
    safe_name = clean_image_name(image_name)
    return f"{Path(safe_name).stem}.jpg"


def ensure_analysis_image(category, source_path):
    if Image is None or ImageOps is None:
        return source_path
    target = (analysis_image_dir(category, create=True) / analysis_image_name(source_path.name)).resolve()
    try:
        target.relative_to(ANALYSIS_IMAGE_ROOT.resolve())
    except ValueError as e:
        raise BadRequest("invalid analysis image path") from e
    if target.exists() and target.stat().st_mtime >= source_path.stat().st_mtime:
        return target

    with Image.open(source_path) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)
        image.thumbnail((ANALYSIS_IMAGE_MAX_WIDTH, ANALYSIS_IMAGE_MAX_HEIGHT), resampling)
        image.save(target, "JPEG", quality=ANALYSIS_IMAGE_JPEG_QUALITY, optimize=True)
    os.utime(target, (source_path.stat().st_atime, source_path.stat().st_mtime))
    return target


def analysis_image_file_path(category, name):
    source_path = image_file_path(category, name)
    path = ensure_analysis_image(clean_category(category), source_path)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(name)
    return path


def analysis_image_url(category, name, base_url):
    params = urllib.parse.urlencode({"category": category, "name": name})
    return f"{base_url}/images/analysis-file?{params}"


def iso_from_timestamp(timestamp):
    return dt.datetime.fromtimestamp(timestamp, tz=dt.timezone.utc).isoformat()


def list_images(category, base_url):
    category = clean_category(category)
    path = category_dir(category, create=True)
    items = []
    for file_path in sorted(path.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not file_path.is_file() or file_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        items.append(image_item(category, file_path, base_url))
    return {
        "ok": True,
        "category": category,
        "count": len(items),
        "items": items,
    }


def clear_images(category):
    category = clean_category(category)
    path = category_dir(category, create=True)
    deleted = []
    for file_path in path.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in IMAGE_EXTENSIONS:
            file_path.unlink()
            deleted.append(file_path.name)
    lowres_path = analysis_image_dir(category, create=True)
    for file_path in lowres_path.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in IMAGE_EXTENSIONS:
            file_path.unlink()
    return {
        "ok": True,
        "category": category,
        "deletedCount": len(deleted),
        "deleted": deleted,
    }


def image_item(category, file_path, base_url):
    stat = file_path.stat()
    params = urllib.parse.urlencode({"category": category, "name": file_path.name})
    return {
        "id": file_path.name,
        "filename": file_path.name,
        "url": f"{base_url}/images/file?{params}",
        "size": stat.st_size,
        "modifiedAt": stat.st_mtime,
        "modifiedAtIso": iso_from_timestamp(stat.st_mtime),
    }


def screenshot_dir(create=False):
    SCREENSHOT_ROOT.mkdir(parents=True, exist_ok=True)
    path = SCREENSHOT_ROOT.resolve()
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def clean_screenshot_name(value):
    name = str(value or "").strip()
    if not name:
        timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        name = f"{timestamp}_{uuid.uuid4().hex[:8]}.png"
    if "/" in name or "\\" in name or name != Path(name).name:
        raise BadRequest("invalid screenshot name")
    if Path(name).suffix.lower() != ".png":
        raise BadRequest("screenshot must be a .png file")
    return name


def screenshot_file_path(name):
    safe_name = clean_screenshot_name(name)
    path = (screenshot_dir(create=True) / safe_name).resolve()
    try:
        path.relative_to(screenshot_dir(create=True))
    except ValueError as e:
        raise BadRequest("invalid screenshot path") from e
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(safe_name)
    return path


def screenshot_item(file_path, base_url):
    stat = file_path.stat()
    params = urllib.parse.urlencode({"name": file_path.name})
    return {
        "id": file_path.name,
        "filename": file_path.name,
        "url": f"{base_url}/screenshots/file?{params}",
        "latestUrl": f"{base_url}/screenshots/latest-file",
        "contentType": "image/png",
        "size": stat.st_size,
        "modifiedAt": stat.st_mtime,
        "modifiedAtIso": iso_from_timestamp(stat.st_mtime),
    }


def latest_screenshot_path():
    path = screenshot_dir(create=True)
    files = [
        file_path
        for file_path in path.iterdir()
        if file_path.is_file() and file_path.suffix.lower() == ".png"
    ]
    if not files:
        raise FileNotFoundError("no screenshot")
    return max(files, key=lambda p: p.stat().st_mtime)


def latest_screenshot(base_url):
    try:
        path = latest_screenshot_path()
    except FileNotFoundError:
        return {
            "ok": True,
            "item": None,
        }
    return {
        "ok": True,
        "item": screenshot_item(path, base_url),
    }


def validate_png_bytes(data):
    if not data:
        raise BadRequest("screenshot body is required")
    if len(data) > MAX_SCREENSHOT_UPLOAD_BYTES:
        raise BadRequest(f"screenshot is too large, max={MAX_SCREENSHOT_UPLOAD_BYTES}")
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise BadRequest("screenshot must be PNG bytes")
    if Image is not None:
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.format != "PNG":
                    raise BadRequest("screenshot must be PNG")
                image.verify()
        except BadRequest:
            raise
        except Exception as e:
            raise BadRequest(f"invalid PNG screenshot: {e}") from e


def save_uploaded_screenshot(name, data, base_url):
    validate_png_bytes(data)
    safe_name = clean_screenshot_name(name)
    path = (screenshot_dir(create=True) / safe_name).resolve()
    try:
        path.relative_to(screenshot_dir(create=True))
    except ValueError as e:
        raise BadRequest("invalid screenshot path") from e
    tmp_path = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    tmp_path.write_bytes(data)
    tmp_path.replace(path)
    return {
        "ok": True,
        "item": screenshot_item(path, base_url),
    }


def storage_dir(root_path, create=False):
    root_path.mkdir(parents=True, exist_ok=True)
    path = root_path.resolve()
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def detect_image_suffix(data, fallback=".png"):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    return fallback


def validate_personal_image_bytes(data):
    if not data:
        raise BadRequest("personal image body is required")
    if len(data) > MAX_PERSONAL_IMAGE_UPLOAD_BYTES:
        raise BadRequest(f"personal image is too large, max={MAX_PERSONAL_IMAGE_UPLOAD_BYTES}")
    suffix = detect_image_suffix(data, "")
    if suffix not in {".png", ".jpg", ".webp"}:
        raise BadRequest("personal image must be PNG, JPG, or WEBP")
    if Image is not None:
        try:
            with Image.open(io.BytesIO(data)) as image:
                if (image.format or "").upper() not in {"PNG", "JPEG", "WEBP"}:
                    raise BadRequest("personal image must be PNG, JPG, or WEBP")
                image.verify()
        except BadRequest:
            raise
        except Exception as e:
            raise BadRequest(f"invalid personal image: {e}") from e
    return suffix


def clean_storage_image_name(value, default_suffix=".png"):
    name = str(value or "").strip()
    if not name:
        timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        name = f"{timestamp}_{uuid.uuid4().hex[:8]}{default_suffix}"
    if "/" in name or "\\" in name or name != Path(name).name:
        raise BadRequest("invalid image name")
    suffix = Path(name).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise BadRequest("unsupported image type")
    return name


def personal_image_dir(create=False):
    return storage_dir(PERSONAL_IMAGE_ROOT, create=create)


def generated_image_dir(create=False):
    return storage_dir(GENERATED_IMAGE_ROOT, create=create)


def storage_image_file_path(root_path, name):
    safe_name = clean_storage_image_name(name)
    root = storage_dir(root_path, create=True)
    path = (root / safe_name).resolve()
    try:
        path.relative_to(root)
    except ValueError as e:
        raise BadRequest("invalid image path") from e
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(safe_name)
    return path


def latest_storage_image_path(root_path):
    root = storage_dir(root_path, create=True)
    files = [
        file_path
        for file_path in root.iterdir()
        if file_path.is_file() and file_path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    ]
    if not files:
        raise FileNotFoundError("no image")
    return max(files, key=lambda p: p.stat().st_mtime)


def personal_image_item(file_path, base_url):
    stat = file_path.stat()
    params = urllib.parse.urlencode({"name": file_path.name})
    return {
        "id": file_path.name,
        "filename": file_path.name,
        "url": f"{base_url}/personal-images/file?{params}",
        "latestUrl": f"{base_url}/personal-images/latest-file",
        "contentType": mimetypes.guess_type(str(file_path))[0] or "application/octet-stream",
        "size": stat.st_size,
        "modifiedAt": stat.st_mtime,
        "modifiedAtIso": iso_from_timestamp(stat.st_mtime),
    }


def generated_image_item(file_path, base_url, metadata=None):
    stat = file_path.stat()
    params = urllib.parse.urlencode({"name": file_path.name})
    item = {
        "id": file_path.name,
        "filename": file_path.name,
        "url": f"{base_url}/personal-images/generated/file?{params}",
        "latestUrl": f"{base_url}/personal-images/generated/latest-file",
        "contentType": mimetypes.guess_type(str(file_path))[0] or "application/octet-stream",
        "size": stat.st_size,
        "modifiedAt": stat.st_mtime,
        "modifiedAtIso": iso_from_timestamp(stat.st_mtime),
    }
    if metadata:
        item.update({
            "sourceFilename": metadata.get("sourceFilename"),
            "prompt": metadata.get("prompt"),
            "remoteUrl": metadata.get("remoteUrl"),
            "model": metadata.get("model"),
            "rawResponse": metadata.get("rawResponse"),
        })
    return item


def latest_personal_image(base_url):
    try:
        path = latest_storage_image_path(PERSONAL_IMAGE_ROOT)
    except FileNotFoundError:
        return {"ok": True, "item": None}
    return {"ok": True, "item": personal_image_item(path, base_url)}


def latest_generated_image(base_url):
    try:
        path = latest_storage_image_path(GENERATED_IMAGE_ROOT)
    except FileNotFoundError:
        return {"ok": True, "item": None}
    return {"ok": True, "item": generated_image_item(path, base_url, read_generated_image_metadata(path))}


def request_json_api(method, url, headers=None, body=None, timeout=30):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method.upper())
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            text = raw.decode("utf-8", errors="replace")
            try:
                return json.loads(text)
            except json.JSONDecodeError as e:
                raise RuntimeError(f"invalid JSON response: {text[:300]}") from e
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {body_text[:500]}") from e


def build_pixel_avatar_prompt(prompt):
    user_prompt = str(prompt or "").strip()
    if not user_prompt:
        return TOKENDANCE_DEFAULT_PROMPT
    return (
        TOKENDANCE_DEFAULT_PROMPT
        + "\n补充要求："
        + user_prompt
    )


def call_tokendance_image_generation(prompt, source_image_url):
    require_value(TOKENDANCE_IMAGE_API_KEY, "TokenDance image API key")
    body = {
        "model": TOKENDANCE_IMAGE_MODEL,
        "prompt": prompt,
        "n": 1,
        "size": TOKENDANCE_IMAGE_SIZE,
        "image_urls": [source_image_url],
    }
    headers = {
        "Authorization": f"Bearer {TOKENDANCE_IMAGE_API_KEY}",
        "Content-Type": "application/json",
    }
    return request_json_api(
        "POST",
        TOKENDANCE_IMAGE_URL,
        headers=headers,
        body=body,
        timeout=TOKENDANCE_IMAGE_TIMEOUT_SECONDS,
    )


def collect_generated_candidates(payload):
    candidates = []

    def add_value(value):
        if isinstance(value, str) and value.strip():
            candidates.append(value.strip())

    def walk(value):
        if isinstance(value, dict):
            for key in ("url", "image_url", "imageUrl", "b64_json", "base64", "image_base64", "data_url"):
                add_value(value.get(key))
            for key in ("data", "images", "image_urls", "output", "result"):
                walk(value.get(key))
        elif isinstance(value, list):
            for item in value:
                walk(item)
        else:
            add_value(value)

    walk(payload)
    return candidates


def decode_image_candidate(candidate):
    text = str(candidate or "").strip()
    if text.startswith("data:image/"):
        _, b64 = text.split(",", 1)
        return base64.b64decode(b64)
    if text.startswith("http://") or text.startswith("https://"):
        req = urllib.request.Request(text)
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    compact = re.sub(r"\s+", "", text)
    if len(compact) > 100:
        try:
            return base64.b64decode(compact, validate=True)
        except Exception:
            return b""
    return b""


def generated_suffix_from_bytes(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    return ".png"


def write_generated_image_metadata(image_path, metadata):
    meta_path = image_path.with_suffix(image_path.suffix + ".json")
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)


def read_generated_image_metadata(image_path):
    meta_path = image_path.with_suffix(image_path.suffix + ".json")
    if not meta_path.exists():
        return {}
    try:
        with meta_path.open("r", encoding="utf-8-sig") as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def save_generated_image(source_path, prompt, generation_response, base_url):
    candidates = collect_generated_candidates(generation_response)
    if not candidates:
        raise RuntimeError("image generation returned no image url or base64")

    last_error = None
    for candidate in candidates:
        try:
            data = decode_image_candidate(candidate)
            if not data:
                continue
            suffix = generated_suffix_from_bytes(data)
            timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
            name = f"{timestamp}_{Path(source_path).stem}_{uuid.uuid4().hex[:8]}{suffix}"
            path = (generated_image_dir(create=True) / name).resolve()
            path.write_bytes(data)
            metadata = {
                "sourceFilename": Path(source_path).name,
                "prompt": prompt,
                "remoteUrl": candidate if str(candidate).startswith(("http://", "https://")) else None,
                "model": TOKENDANCE_IMAGE_MODEL,
                "rawResponse": generation_response,
                "createdAtIso": now_iso(),
            }
            write_generated_image_metadata(path, metadata)
            return generated_image_item(path, base_url, metadata)
        except Exception as e:
            last_error = e
    raise RuntimeError(f"failed to save generated image: {last_error}")


def compress_personal_avatar_bytes(data):
    validate_personal_image_bytes(data)
    if Image is None or ImageOps is None:
        raise BadRequest("Pillow is required to crop and compress avatar under 100KB")

    with Image.open(io.BytesIO(data)) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode in {"RGBA", "LA"} or image.info.get("transparency") is not None:
            rgba = image.convert("RGBA")
            background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            background.alpha_composite(rgba)
            image = background.convert("RGB")
        else:
            image = image.convert("RGB")
        resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)
        for side in (512, 448, 384, 320, 256, 192, 160):
            candidate = ImageOps.fit(image, (side, side), method=resampling, centering=(0.5, 0.5))
            for quality in (88, 78, 68, 58, 48, 38, 30, 24):
                output = io.BytesIO()
                candidate.save(output, "JPEG", quality=quality, optimize=True, progressive=True)
                payload = output.getvalue()
                if len(payload) <= MAX_PERSONAL_AVATAR_BYTES:
                    return payload, ".jpg", side
    raise BadRequest(f"square avatar cannot be compressed under {MAX_PERSONAL_AVATAR_BYTES} bytes")


def clear_image_storage_dir(root_path):
    root = storage_dir(root_path, create=True)
    for file_path in root.iterdir():
        if file_path.is_file():
            try:
                file_path.unlink()
            except Exception:
                pass


def notify_glasses_avatar_updated(device_id, avatar_item):
    command = {
        "type": "user_avatar_updated",
        "deviceId": clean_device_id(device_id or TRANSITION_TTS_DEVICE_ID),
        "imageUrl": avatar_item["url"],
        "latestUrl": avatar_item["latestUrl"],
        "filename": avatar_item["filename"],
        "contentType": avatar_item["contentType"],
        "size": avatar_item["size"],
        "shape": avatar_item.get("shape"),
        "width": avatar_item.get("width"),
        "height": avatar_item.get("height"),
        "message": "用户头像已更新，请保存",
        "source": "personal_avatar_upload",
    }
    return send_glasses_command(command)


def save_personal_avatar(name, data, base_url, device_id=""):
    compressed, _, side = compress_personal_avatar_bytes(data)
    path = (personal_image_dir(create=True) / PERSONAL_AVATAR_FILENAME).resolve()
    try:
        path.relative_to(personal_image_dir(create=True))
    except ValueError as e:
        raise BadRequest("invalid personal image path") from e
    clear_image_storage_dir(PERSONAL_IMAGE_ROOT)
    clear_image_storage_dir(GENERATED_IMAGE_ROOT)
    tmp_path = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    tmp_path.write_bytes(compressed)
    tmp_path.replace(path)

    avatar_item = personal_image_item(path, base_url)
    avatar_item.update({
        "shape": "square",
        "width": side,
        "height": side,
    })
    notify_result = notify_glasses_avatar_updated(device_id, avatar_item)
    return {
        "ok": True,
        "mode": "single_avatar",
        "avatar": avatar_item,
        "source": avatar_item,
        "compressed": True,
        "maxBytes": MAX_PERSONAL_AVATAR_BYTES,
        "originalBytes": len(data),
        "savedBytes": avatar_item["size"],
        "shape": "square",
        "width": side,
        "height": side,
        "retainedCount": 1,
        "glassesNotification": notify_result,
    }


def save_personal_image_and_generate(name, data, prompt, base_url, device_id=""):
    return save_personal_avatar(name, data, base_url, device_id)


def analysis_dir(category, create=False):
    ANALYSIS_ROOT.mkdir(parents=True, exist_ok=True)
    root = ANALYSIS_ROOT.resolve()
    path = (root / category).resolve()
    try:
        path.relative_to(root)
    except ValueError as e:
        raise BadRequest("invalid analysis path") from e
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def analysis_path(category, image_name):
    safe_name = clean_image_name(image_name)
    return analysis_dir(category, create=True) / f"{safe_name}.json"


def now_iso():
    return dt.datetime.now(tz=dt.timezone.utc).isoformat()


def sse_payload(event_type, payload):
    body = json.dumps(payload or {}, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_type}\ndata: {body}\n\n".encode("utf-8")


def register_sse_client(device_id):
    client_id = uuid.uuid4().hex
    client_queue = queue.Queue(maxsize=50)
    replaced_clients = []
    with SSE_CLIENTS_LOCK:
        for existing_id, existing_client in list(SSE_CLIENTS.items()):
            if existing_client.get("deviceId") == device_id:
                replaced_clients.append((existing_id, existing_client))
                SSE_CLIENTS.pop(existing_id, None)
        SSE_CLIENTS[client_id] = {
            "deviceId": device_id,
            "queue": client_queue,
            "connectedAtIso": now_iso(),
        }
    for existing_id, existing_client in replaced_clients:
        enqueue_client_event(existing_client["queue"], {
            "event": "__close",
            "payload": {
                "reason": "replaced",
                "deviceId": device_id,
                "newClientId": client_id,
            },
        })
    if replaced_clients:
        sys.stdout.write(f"replaced {len(replaced_clients)} SSE client(s) for deviceId={device_id}\n")
        sys.stdout.flush()
    return client_id, client_queue


def unregister_sse_client(client_id):
    with SSE_CLIENTS_LOCK:
        SSE_CLIENTS.pop(client_id, None)


def enqueue_client_event(client_queue, event):
    try:
        client_queue.put_nowait(event)
    except queue.Full:
        try:
            client_queue.get_nowait()
        except queue.Empty:
            pass
        try:
            client_queue.put_nowait(event)
        except queue.Full:
            pass


def broadcast_glasses_event(event_type, payload, target_device_id=""):
    with SSE_CLIENTS_LOCK:
        clients = list(SSE_CLIENTS.values())
    delivered = 0
    for client in clients:
        if target_device_id and client.get("deviceId") != target_device_id:
            continue
        enqueue_client_event(client["queue"], {
            "event": event_type,
            "payload": payload or {},
        })
        delivered += 1
    return delivered


def default_analysis(category, image_name, status="pending", error=""):
    return {
        "analysisStatus": status,
        "scene": "一个人的默认",
        "confidence": 0.0,
        "reason": "",
        "evidence": [],
        "category": category,
        "filename": image_name,
        "provider": IMAGE_LLM_PROVIDER,
        "model": IMAGE_LLM_MODEL,
        "updatedAtIso": now_iso(),
        "error": error,
    }


def read_analysis(category, image_name):
    path = analysis_path(category, image_name)
    if not path.exists():
        return default_analysis(category, image_name)
    try:
        with path.open("r", encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception as e:
        return default_analysis(category, image_name, status="invalid_analysis", error=str(e))


def write_analysis(category, image_name, payload):
    payload = dict(payload)
    payload["category"] = category
    payload["filename"] = image_name
    payload["updatedAtIso"] = now_iso()
    path = analysis_path(category, image_name)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    return payload


def latest_image_path(category):
    category = clean_category(category or DEFAULT_IMAGE_CATEGORY)
    path = category_dir(category, create=True)
    files = [
        p for p in path.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    ]
    if not files:
        return category, None
    return category, max(files, key=lambda p: p.stat().st_mtime)


def build_image_scene_prompt():
    labels = "、".join(SCENE_LABELS)
    return (
        "你是眼镜第一视角图片的场景分类器。"
        f"你只能从以下状态中选择一个：{labels}。\n"
        "判断时必须以整张图片的主要视觉主体和主要活动为准，而不是被边缘区域、局部小物体、"
        "远处人物或短暂出现的物品带偏。\n"
        "更重要的是：你要判断佩戴眼镜的人，也就是第一视角用户正在做什么；"
        "不要把画面中其他人的行为误判成用户自己的行为。\n"
        "主体判断规则：\n"
        "A. 先判断画面中心、面积最大、最清晰、最接近第一视角操作目标的内容。\n"
        "B. 如果电脑/手机只是在边缘、小面积、模糊、被遮挡，不能仅凭它出现就分类为看电脑/看手机。\n"
        "C. 如果画面中其他人在看手机、刷手机、用电脑，但第一视角用户没有明显在操作这些设备，"
        "不能把它分类为看手机或看电脑。\n"
        "D. 如果第一视角主要面对某个人或一群人，即使对方手里拿着手机或正在刷手机，"
        "也应优先判断用户是否在与对方交流；有交流语境时分类为和朋友聊天。\n"
        "E. 如果画面里有其他人，但不是主要互动对象，或只是路过/背景/局部出现，不能仅凭有人就分类为和朋友聊天。\n"
        "F. 只有当对话对象占据主要画面、存在明显面对面交流或多人聚集交流时，才分类为和朋友聊天。\n"
        "G. 只有当零食、奶茶、饮料、饭菜、餐盘、餐盒、杯子等吃喝相关物体处在画面中心、近处、清晰、面积较大，"
        "并构成主要视觉主体，或第一视角用户明显正在吃、喝、拿取食物饮料时，才分类为吃喝。\n"
        "H. 如果食物/饮料只是在边缘、小面积、背景、远处、模糊、桌面杂物中偶然出现，不能仅凭它出现就分类为吃喝。\n"
        "I. 如果主体不明确、多个线索冲突且无法判断第一视角用户的主要活动，优先返回一个人的默认。\n"
        "分类含义：\n"
        "1. 看电脑：第一视角用户正在看/操作自己的电脑，画面主体是电脑屏幕、键盘、显示器、桌面办公/学习，且电脑相关内容是主要视觉目标。\n"
        "2. 看手机：第一视角用户正在看/操作自己的手机，且手机是主要视觉目标；别人拿手机或刷手机不算看手机。\n"
        "3. 摸鱼：非学习/工作状态，例如发呆、睡觉、娱乐、刷无关内容、网购、无明显任务推进。\n"
        "4. 和朋友聊天：第一视角用户正在与同伴交流、聚在一起聊天、面对面社交；对方拿着手机也不改变该判断。\n"
        "5. 写东西：正在手写、记笔记、写作业、纸笔/白板书写为主。\n"
        "6. 吃喝：画面主体是零食、奶茶、饮料、饭菜、餐盘/餐盒等，或用户明显正在吃饭、喝饮料、拿取食物饮料。\n"
        "7. 一个人的默认：一个人独处且无法明确归入其他状态，或画面信息不足。\n"
        "请严格只输出一个 JSON 对象，不要输出 Markdown，不要输出代码块，不要输出解释性文本，"
        "不要在 JSON 前后添加任何其他字符。\n"
        "必须使用双引号，必须包含且只包含以下字段：scene、confidence、reason、evidence。\n"
        "scene 必须是上述状态之一；confidence 必须是 0 到 1 的数字；reason 必须是一句话中文原因，"
        "并说明你依据的主要视觉主体；"
        "evidence 必须是字符串数组。\n"
        "返回格式示例：\n"
        "{"
        "\"scene\":\"看电脑\","
        "\"confidence\":0.86,"
        "\"reason\":\"画面主体是电脑屏幕和桌面办公环境，用户当前更像在看电脑。\","
        "\"evidence\":[\"画面中有电脑屏幕\",\"桌面环境明显\",\"视角集中在屏幕区域\"]"
        "}"
    )


def extract_json_object(text):
    text = (text or "").strip()
    if not text:
        raise ValueError("empty model response")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise


def normalize_scene(value):
    scene = str(value or "").strip()
    return scene if scene in SCENE_LABEL_SET else "一个人的默认"


def parse_scene_response(text):
    try:
        return extract_json_object(text)
    except Exception:
        for label in SCENE_LABELS:
            if label in text:
                return {
                    "scene": label,
                    "confidence": 0.5,
                    "reason": text[:240],
                    "evidence": [],
                }
        raise


def anthropic_text_content(data):
    chunks = data.get("content") or []
    if isinstance(chunks, str):
        return chunks
    texts = []
    for chunk in chunks:
        if isinstance(chunk, dict) and chunk.get("type") == "text":
            texts.append(str(chunk.get("text") or ""))
    return "\n".join(texts).strip()


def call_image_llm_scene(image_url):
    if not IMAGE_LLM_API_KEY:
        raise ConfigError("IMAGE_LLM_API_KEY is not configured")
    payload = {
        "model": IMAGE_LLM_MODEL,
        "system": build_image_scene_prompt(),
        "max_tokens": 256,
        "temperature": 0.0,
        "thinking": {"type": "disabled"},
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "分析这张 Rokid 眼镜第一视角图片，按整张图片的主要视觉主体和主要活动，从六个候选状态中选一个，返回 JSON。",
                    },
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": image_url,
                        },
                    },
                ],
            },
        ],
    }
    request = urllib.request.Request(
        IMAGE_LLM_MESSAGES_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {IMAGE_LLM_API_KEY}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=IMAGE_LLM_TIMEOUT_SECONDS) as response:
        data = json.loads(response.read().decode("utf-8"))
    content = anthropic_text_content(data)
    parsed = parse_scene_response(content)
    return {
        "analysisStatus": "done",
        "scene": normalize_scene(parsed.get("scene")),
        "confidence": float(parsed.get("confidence") or 0.0),
        "reason": str(parsed.get("reason") or ""),
        "evidence": parsed.get("evidence") if isinstance(parsed.get("evidence"), list) else [],
        "provider": IMAGE_LLM_PROVIDER,
        "model": IMAGE_LLM_MODEL,
        "raw": parsed,
    }


def transition_state_path(category):
    return analysis_dir(category, create=True) / "_transition_state.json"


def read_transition_state(category):
    path = transition_state_path(category)
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return {}


def write_transition_state(category, payload):
    path = transition_state_path(category)
    data = dict(payload or {})
    data["category"] = category
    data["updatedAtIso"] = now_iso()
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    return data


def build_transition_tts_prompt():
    labels = "、".join(SCENE_LABELS)
    return (
        "你是眼镜端的轻量状态提醒文案生成器。"
        f"状态只会来自这些类型：{labels}。\n"
        "用户会给你上一状态和当前状态，你要生成一句适合直接 TTS 播放的中文短句。\n"
        "风格：像一个有点幽默、轻微吐槽、但不恶意的人在提醒。"
        "切到看电脑、写东西时偏鼓励；切到看手机、摸鱼、和朋友聊天、吃喝时轻微提醒或吐槽；"
        "参考例子：看电脑到和朋友聊天，可以说“又开始唠嗑了？差不多收一收。”；"
        "看手机到看电脑，可以说“不错，回到电脑前继续学习。”；"
        "摸鱼到写东西，可以说“开始动笔了，这个节奏可以。”\n"
        "限制：12到28个中文字左右；不要表情；不要英文；不要解释；"
        "不要说“上一状态/当前状态/切换/分类”；不要复述两个状态名；"
        "不要输出 Markdown；不要输出代码块；不要攻击、羞辱具体人。\n"
        "严格只输出 JSON：{\"text\":\"一句短TTS文案\"}"
    )


def clean_transition_tts_text(value):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = text.strip("\"'“”‘’`")
    if len(text) > 48:
        text = text[:48].rstrip("，。！？、 ") + "。"
    return text


def fallback_transition_tts(previous_scene, current_scene):
    previous_scene = normalize_scene(previous_scene)
    current_scene = normalize_scene(current_scene)
    if previous_scene == "看手机" and current_scene == "看电脑":
        return "不错，回到电脑前继续学习。"
    if current_scene == "看电脑":
        return "不错，进入专注模式，继续保持。"
    if current_scene == "写东西":
        return "开始动笔了，这个节奏可以。"
    if current_scene == "看手机":
        return "手机先放一放，别被它带跑了。"
    if current_scene == "摸鱼":
        return "摸鱼信号出现，赶紧切回正事。"
    if current_scene == "和朋友聊天":
        return "又开始唠嗑了？差不多收一收。"
    if current_scene == "吃喝":
        return "补给可以，别把正事一起咽下去了。"
    return "节奏变了，继续盯住目标。"


def group_chat_criticism_text(current_scene):
    current_scene = normalize_scene(current_scene)
    if current_scene == "看手机":
        return random.choice([
            "@我 手机又亮起来了？先把手头任务收住。",
            "@我 这屏刷得挺顺，KPI 可不会自己往前走。",
            "@我 开始玩起手机了？先回来把正事推进一下。",
        ])
    if current_scene == "和朋友聊天":
        return random.choice([
            "@我 聊得挺热闹，任务进度也同步热闹一下？",
            "@我 又开小会了？先把手头任务收一下。",
            "@我 社交能量很足，工作进度也请同步补上。",
        ])
    return "@我 节奏有点飘，先回到今天的任务。"


def current_kpi_points():
    with KPI_STORE_LOCK:
        store = read_kpi_store()
    record = store.get(KPI_GLOBAL_KEY) or store.get("default") or {}
    return normalize_kpi_points(record.get("points") or record.get("kpi"))


def clean_group_chat_text(value, max_length=48):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = text.strip("\"'“”‘’`")
    text = text.replace("状态切换", "").replace("从工作状态切到", "").strip()
    if len(text) > max_length:
        text = text[:max_length].rstrip("，。！？、 ") + "。"
    return text


def parse_group_chat_llm_response(text):
    payload = extract_json_object(text)
    notice = payload.get("notice") if isinstance(payload.get("notice"), dict) else {}
    notice_text = clean_group_chat_text(notice.get("text") or payload.get("text"))
    if not notice_text.startswith("@我"):
        notice_text = "@我 " + notice_text.lstrip("@ ")
    raw_replies = payload.get("replies") if isinstance(payload.get("replies"), list) else []
    replies = []
    allowed = {"HR", "Leader", "技术", "运营", "产品"}
    for item in raw_replies[:2]:
        if not isinstance(item, dict):
            continue
        nickname = str(item.get("nickname") or "").strip()
        text = clean_group_chat_text(item.get("text"), max_length=44)
        if nickname not in allowed or not text:
            continue
        replies.append({"nickname": nickname, "text": text})
    return {
        "noticeText": notice_text,
        "replies": replies[:2],
    }


def call_group_chat_llm(previous_scene, current_scene):
    if not IMAGE_LLM_API_KEY:
        raise ConfigError("IMAGE_LLM_API_KEY is not configured")
    previous_scene = normalize_scene(previous_scene)
    current_scene = normalize_scene(current_scene)
    points = current_kpi_points()
    kpi_text = "；".join(points[:5]) if points else "完成当前工作任务"
    payload = {
        "model": IMAGE_LLM_MODEL,
        "system": (
            "你是一个群聊里的牛马云机器人，负责用轻微吐槽但不恶毒的方式通报工作分心行为。"
            "你要生成一条主通报和1到2条员工回复。"
            "主通报昵称固定牛马云，文本必须以“@我 ”开头。"
            "不要出现“状态切换”“从工作状态切到”“上一状态”“当前状态”等机制描述。"
            "员工回复昵称只能从 HR、Leader、技术、运营、产品 中选择。"
            "语气像办公室群聊调侃，短、自然、有变化，不要固定提“KPI还记得吗”。"
            "不要攻击人格，不要脏话，不要表情，不要Markdown。"
            "严格只输出JSON：{\"notice\":{\"text\":\"@我 ...\"},\"replies\":[{\"nickname\":\"HR\",\"text\":\"...\"}]}"
        ),
        "max_tokens": 220,
        "temperature": 0.9,
        "thinking": {"type": "disabled"},
        "messages": [
            {
                "role": "user",
                "content": (
                    f"上一状态：{previous_scene}\n"
                    f"当前状态：{current_scene}\n"
                    f"当前KPI分点：{kpi_text}\n"
                    "请为群聊生成主通报和1到2条员工回复。"
                ),
            },
        ],
    }
    request = urllib.request.Request(
        IMAGE_LLM_MESSAGES_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {IMAGE_LLM_API_KEY}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=IMAGE_LLM_TIMEOUT_SECONDS) as response:
        data = json.loads(response.read().decode("utf-8"))
    parsed = parse_group_chat_llm_response(anthropic_text_content(data))
    if not parsed["noticeText"]:
        raise ValueError("empty group chat notice")
    return parsed


def generate_group_chat_copy(previous_scene, current_scene):
    try:
        parsed = call_group_chat_llm(previous_scene, current_scene)
        if parsed.get("replies"):
            return parsed, "llm"
        return {
            "noticeText": parsed["noticeText"],
            "replies": [
                {"nickname": nickname, "text": text}
                for nickname, text in random.sample(group_chat_reply_candidates(current_scene), k=1)
            ],
        }, "llm_with_fallback_replies"
    except Exception as e:
        print(f"group chat llm failed: {e}", file=sys.stderr)
        return {
            "noticeText": group_chat_criticism_text(current_scene),
            "replies": [
                {"nickname": nickname, "text": text}
                for nickname, text in random.sample(
                    group_chat_reply_candidates(current_scene),
                    k=random.randint(1, min(2, len(group_chat_reply_candidates(current_scene)))),
                )
            ],
        }, "fallback"


def group_chat_reply_candidates(current_scene):
    current_scene = normalize_scene(current_scene)
    if current_scene == "看手机":
        return [
            ("HR", "我先记一笔，下午复盘的时候别说没提醒。"),
            ("Leader", "手机先放一下，Demo 主链路还没完全稳。"),
            ("技术", "接口都还没测完，先别进入刷屏模式。"),
            ("运营", "这个状态我都能截图做日报素材了。"),
            ("产品", "先把核心流程跑通，等会儿再看也来得及。"),
        ]
    if current_scene == "和朋友聊天":
        return [
            ("HR", "聊天可以，先确认今天 KPI 不会延迟。"),
            ("Leader", "社交能量先收一收，任务优先级别丢。"),
            ("技术", "你们聊的时候，bug 不会自己消失。"),
            ("运营", "这段我可以直接写进群聊战报了。"),
            ("产品", "先把演示路径闭环，再开茶话会。"),
        ]
    return [
        ("HR", "收到，状态已同步到群内。"),
        ("Leader", "先回到任务主线。"),
    ]


def build_group_chat_replies(base_url, current_scene):
    candidates = group_chat_reply_candidates(current_scene)
    selected = random.sample(candidates, k=random.randint(1, min(2, len(candidates))))
    return [
        {
            "type": "reply",
            "avatarUrl": group_chat_avatar_url(base_url, nickname),
            "nickname": nickname,
            "text": text,
            "imageUrl": None,
            "image": None,
            "scene": normalize_scene(current_scene),
        }
        for nickname, text in selected
    ]


def reply_messages_from_copy(base_url, current_scene, replies, source):
    return [
        {
            "type": "reply",
            "avatarUrl": group_chat_avatar_url(base_url, item["nickname"]),
            "nickname": item["nickname"],
            "text": item["text"],
            "imageUrl": None,
            "image": None,
            "scene": normalize_scene(current_scene),
            "copySource": source,
        }
        for item in replies[:2]
    ]


def insert_mock_group_chat_message(body=None, query=None, base_url=""):
    body = body if isinstance(body, dict) else {}
    query = query if isinstance(query, dict) else {}
    group_id = clean_group_id(body.get("groupId") or body.get("group_id") or query.get("groupId") or query.get("group_id") or GROUP_CHAT_DEFAULT_ID)
    category = clean_category(body.get("category") or query.get("category") or DEFAULT_IMAGE_CATEGORY)
    category, file_path = latest_image_path(category)
    if file_path is None:
        raise BadRequest("no captured image found")

    ensure_analysis_image(category, file_path)
    nickname = str(body.get("nickname") or query.get("nickname") or "牛马云").strip() or "牛马云"
    scene = normalize_scene(body.get("scene") or query.get("scene") or "看手机")
    copy_source = "manual"
    generated_replies = []
    text = str(body.get("text") or query.get("text") or "").strip()
    if not text:
        generated, copy_source = generate_group_chat_copy("看电脑", scene)
        text = generated["noticeText"]
        generated_replies = generated["replies"]
    image_url = analysis_image_url(category, file_path.name, base_url)
    message = {
        "type": "mock",
        "avatarUrl": group_chat_avatar_url(base_url, nickname),
        "nickname": nickname,
        "text": text,
        "imageUrl": image_url,
        "image": {
            "url": image_url,
            "filename": file_path.name,
        },
        "category": category,
        "filename": file_path.name,
        "scene": scene,
        "source": "mock",
        "copySource": copy_source,
    }
    messages = [message, *reply_messages_from_copy(base_url, scene, generated_replies, copy_source)]
    result = append_group_chat_messages(group_id, messages)
    return {
        "ok": True,
        "groupId": group_id,
        "inserted": result.get("items"),
        "count": result.get("count"),
    }


def maybe_append_group_chat_notice(category, transition, current_analysis, base_url):
    if not transition or not current_analysis or current_analysis.get("analysisStatus") != "done":
        return None
    previous_scene = normalize_scene(transition.get("previousScene"))
    current_scene = normalize_scene(current_analysis.get("scene"))
    if previous_scene not in GROUP_CHAT_WORK_SCENES or current_scene not in GROUP_CHAT_CRITIC_SCENES:
        return None

    category = clean_category(category or DEFAULT_IMAGE_CATEGORY)
    filename = clean_image_name(current_analysis.get("filename"))
    nickname = "牛马云"
    image_url = analysis_image_url(category, filename, base_url)
    generated, copy_source = generate_group_chat_copy(previous_scene, current_scene)
    message = {
        "type": "criticism",
        "avatarUrl": group_chat_avatar_url(base_url, nickname),
        "nickname": nickname,
        "text": generated["noticeText"],
        "imageUrl": image_url,
        "image": {
            "url": image_url,
            "filename": filename,
        },
        "category": category,
        "filename": filename,
        "previousScene": previous_scene,
        "scene": current_scene,
        "copySource": copy_source,
    }
    messages = [message, *reply_messages_from_copy(base_url, current_scene, generated["replies"], copy_source)]
    result = append_group_chat_messages(GROUP_CHAT_DEFAULT_ID, messages)
    print(
        f"group chat notice {category}: {previous_scene} -> {current_scene}; "
        f"added={len(messages)}; count={result['count']}",
        flush=True,
    )
    return result


def is_low_quality_transition_tts(text):
    text = str(text or "")
    blocked = ["上一状态", "当前状态", "切换", "分类", "从摸鱼状态", "从工作模式"]
    return any(word in text for word in blocked)


def parse_transition_tts_response(text):
    try:
        payload = extract_json_object(text)
        return clean_transition_tts_text(payload.get("text"))
    except Exception:
        return clean_transition_tts_text(text)


def call_transition_tts_llm(previous_scene, current_scene):
    if not IMAGE_LLM_API_KEY:
        raise ConfigError("IMAGE_LLM_API_KEY is not configured")
    previous_scene = normalize_scene(previous_scene)
    current_scene = normalize_scene(current_scene)
    payload = {
        "model": IMAGE_LLM_MODEL,
        "system": build_transition_tts_prompt(),
        "max_tokens": 96,
        "temperature": 0.7,
        "thinking": {"type": "disabled"},
        "messages": [
            {
                "role": "user",
                "content": (
                    f"上一状态：{previous_scene}\n"
                    f"当前状态：{current_scene}\n"
                    "请生成一句直接播放给眼镜佩戴者听的短TTS文案。"
                ),
            },
        ],
    }
    request = urllib.request.Request(
        IMAGE_LLM_MESSAGES_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {IMAGE_LLM_API_KEY}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=IMAGE_LLM_TIMEOUT_SECONDS) as response:
        data = json.loads(response.read().decode("utf-8"))
    text = parse_transition_tts_response(anthropic_text_content(data))
    if not text:
        raise ValueError("empty transition tts text")
    return text


def generate_transition_tts(previous_scene, current_scene):
    try:
        text = call_transition_tts_llm(previous_scene, current_scene)
        if is_low_quality_transition_tts(text):
            return fallback_transition_tts(previous_scene, current_scene), "fallback_after_llm"
        return text, "llm"
    except Exception as e:
        print(f"transition tts llm failed: {e}", file=sys.stderr)
        return fallback_transition_tts(previous_scene, current_scene), "fallback"


def maybe_send_transition_tts(category, previous_analysis, current_analysis):
    if not TRANSITION_TTS_ENABLED:
        return None
    if not current_analysis or current_analysis.get("analysisStatus") != "done":
        return None

    category = clean_category(category or DEFAULT_IMAGE_CATEGORY)
    current_scene = normalize_scene(current_analysis.get("scene"))
    current_filename = current_analysis.get("filename") or ""
    with TRANSITION_TTS_LOCK:
        state = read_transition_state(category)
        previous_scene = normalize_scene(state.get("scene")) if state.get("scene") else ""
        previous_filename = state.get("filename") or ""
        if not previous_scene and previous_analysis:
            previous_scene = normalize_scene(previous_analysis.get("scene"))
            previous_filename = previous_analysis.get("filename") or ""

        base_state = {
            "scene": current_scene,
            "filename": current_filename,
            "previousScene": previous_scene or None,
            "previousFilename": previous_filename or None,
        }

        if not previous_scene:
            write_transition_state(category, {
                **base_state,
                "transition": "initialized",
            })
            return None

        if previous_scene == current_scene:
            write_transition_state(category, {
                **base_state,
                "transition": "unchanged",
            })
            return None

        text, source = generate_transition_tts(previous_scene, current_scene)
        payload = {
            "deviceId": TRANSITION_TTS_DEVICE_ID,
            "type": "tts",
            "text": text,
            "category": category,
            "previousScene": previous_scene,
            "scene": current_scene,
            "filename": current_filename,
            "source": "scene_transition",
            "llmSource": source,
            "createdAtIso": now_iso(),
        }
        payload = apply_tts_voice(payload)
        delivered = broadcast_glasses_event("command", payload, TRANSITION_TTS_DEVICE_ID)
        state_payload = {
            **base_state,
            "transition": "changed",
            "ttsText": text,
            "ttsSource": source,
            "ttsDelivered": delivered,
            "voiceName": payload.get("voiceName"),
            "voiceType": payload.get("voiceType"),
        }
        write_transition_state(category, state_payload)
        print(
            f"scene transition {category}: {previous_scene} -> {current_scene}; "
            f"tts={text}; delivered={delivered}",
            flush=True,
        )
        return state_payload


def analyze_image_file(category, file_path, base_url):
    _, previous_analysis = latest_done_analysis(category)
    try:
        ensure_analysis_image(category, file_path)
        image_url = analysis_image_url(category, file_path.name, base_url)
        result = call_image_llm_scene(image_url)
    except ConfigError as e:
        result = default_analysis(category, file_path.name, status="missing_config", error=str(e))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        result = default_analysis(category, file_path.name, status="failed", error=f"HTTP {e.code}: {body}")
    except Exception as e:
        result = default_analysis(category, file_path.name, status="failed", error=str(e))
    written = write_analysis(category, file_path.name, result)
    if written.get("analysisStatus") == "done":
        broadcast_glasses_event("status", client_status(category, base_url))
        transition = maybe_send_transition_tts(category, previous_analysis, written)
        group_notice = maybe_append_group_chat_notice(category, transition, written, base_url)
        if transition:
            extra = {"transitionTts": transition}
            if group_notice:
                extra["groupChatNotice"] = group_notice
            written = write_analysis(category, file_path.name, {**written, **extra})
    return written


def analyze_image_async(category, file_path, base_url):
    write_analysis(category, file_path.name, default_analysis(category, file_path.name, status="running"))
    thread = threading.Thread(
        target=analyze_image_file,
        args=(category, file_path, base_url),
        name=f"ImageSceneAnalysis-{category}-{file_path.name}",
        daemon=True,
    )
    thread.start()


def app_status(category, base_url, analyze_if_needed=True):
    category, file_path = latest_image_path(category)
    if file_path is None:
        return {
            "ok": True,
            "category": category,
            "scene": "一个人的默认",
            "analysisStatus": "empty",
            "image": None,
            "analysis": default_analysis(category, "", status="empty"),
            "sceneLabels": SCENE_LABELS,
        }

    analysis = read_analysis(category, file_path.name)
    if analyze_if_needed and analysis.get("analysisStatus") in {"pending", "invalid_analysis"}:
        analyze_image_async(category, file_path, base_url)
    return {
        "ok": True,
        "category": category,
        "scene": normalize_scene(analysis.get("scene")),
        "analysisStatus": analysis.get("analysisStatus", "pending"),
        "image": image_item(category, file_path, base_url),
        "analysis": analysis,
        "sceneLabels": SCENE_LABELS,
    }


def latest_done_analysis(category):
    category = clean_category(category or DEFAULT_IMAGE_CATEGORY)
    path = analysis_dir(category, create=True)
    latest = None
    for json_path in path.iterdir():
        if not json_path.is_file() or json_path.suffix.lower() != ".json":
            continue
        try:
            with json_path.open("r", encoding="utf-8-sig") as f:
                payload = json.load(f)
        except Exception:
            continue
        if payload.get("analysisStatus") != "done":
            continue
        filename = payload.get("filename") or json_path.name[:-5]
        try:
            clean_image_name(filename)
        except BadRequest:
            continue
        item = (json_path.stat().st_mtime, payload)
        if latest is None or item[0] > latest[0]:
            latest = item
    return category, latest[1] if latest else None


def client_status(category, base_url):
    category, analysis = latest_done_analysis(category)
    if not analysis:
        return {
            "ok": True,
            "category": category,
            "state": "一个人的默认",
            "scene": "一个人的默认",
            "analysisStatus": "empty",
            "confidence": 0.0,
            "reason": "",
            "evidence": [],
            "imageUrl": None,
            "filename": None,
            "updatedAtIso": None,
            "sceneLabels": SCENE_LABELS,
        }

    filename = clean_image_name(analysis.get("filename"))

    return {
        "ok": True,
        "category": category,
        "state": normalize_scene(analysis.get("scene")),
        "scene": normalize_scene(analysis.get("scene")),
        "analysisStatus": analysis.get("analysisStatus", "done"),
        "updatedAtIso": analysis.get("updatedAtIso"),
        "confidence": analysis.get("confidence", 0.0),
        "reason": analysis.get("reason", ""),
        "evidence": analysis.get("evidence", []),
        "imageUrl": analysis_image_url(category, filename, base_url),
        "filename": filename,
        "sceneLabels": SCENE_LABELS,
    }


def status_event_key(status):
    if not status:
        return ""
    return "|".join([
        str(status.get("category") or ""),
        str(status.get("filename") or ""),
        str(status.get("scene") or ""),
        str(status.get("analysisStatus") or ""),
        str(status.get("updatedAtIso") or ""),
    ])


def send_glasses_command(body):
    if not isinstance(body, dict):
        raise BadRequest("json body is required")
    command_type = str(body.get("type") or "message").strip()
    if not command_type:
        raise BadRequest("type is required")
    target_device_id = str(body.get("deviceId") or body.get("targetDeviceId") or "").strip()
    if target_device_id:
        target_device_id = clean_device_id(target_device_id)
    payload = dict(body)
    payload["type"] = command_type
    if command_type == "tts":
        payload = apply_tts_voice(payload)
    payload["createdAtIso"] = now_iso()
    delivered = broadcast_glasses_event("command", payload, target_device_id)
    return {
        "ok": True,
        "event": "command",
        "delivered": delivered,
        "targetDeviceId": target_device_id or None,
        "payload": payload,
    }


def request_glasses_rtc_exit(body=None, query=None):
    return {
        "ok": False,
        "deprecated": True,
        "action": "exit_rtc",
        "error": "deprecated endpoint",
        "message": "RTC exit API 已弃用，请在老板最后一句 RTC 字幕尾部追加 [[RTC_EXIT]]，眼镜端会解析该标识并退出 RTC。",
        "replacement": {
            "type": "rtc_subtitle_tail_marker",
            "marker": "[[RTC_EXIT]]",
            "example": "今天先聊到这里，回去把目标写清楚。[[RTC_EXIT]]",
        },
    }


def request_onboarding_training_start(body=None, query=None):
    body = body if isinstance(body, dict) else {}
    query = query if isinstance(query, dict) else {}
    target_device_id = (
        body.get("deviceId")
        or body.get("targetDeviceId")
        or query.get("deviceId")
        or query.get("targetDeviceId")
        or "rokid-glasses-001"
    )
    command = {
        "type": "start_onboarding_training",
        "deviceId": clean_device_id(target_device_id),
        "scenario": "onboarding",
        "message": "开启入职培训",
        "welcomeMessage": ONBOARDING_WELCOME_MESSAGE,
    }
    result = send_glasses_command(command)
    result["action"] = "start_onboarding_training"
    result["scenario"] = "onboarding"
    result["welcomeMessage"] = ONBOARDING_WELCOME_MESSAGE
    result["llmConfig"] = {
        "Mode": ONBOARDING_LLM_CONFIG["Mode"],
        "Url": ONBOARDING_LLM_CONFIG["Url"],
        "ModelName": ONBOARDING_LLM_CONFIG["ModelName"],
    }
    return result


def kpi_value_from_body(body):
    for key in ("points", "items", "kpi", "kpis", "goal", "goals", "okr", "text"):
        if key in body:
            return body.get(key)
    raise BadRequest("kpi is required")


def clean_kpi_point(value):
    point = re.sub(r"\s+", " ", str(value or "")).strip()
    point = re.sub(r"^[-*•\d.、\)\s]+", "", point).strip()
    return point


def normalize_kpi_points(value):
    if isinstance(value, list):
        points = [clean_kpi_point(item) for item in value]
    elif isinstance(value, dict):
        nested = value.get("points") or value.get("items") or value.get("kpis") or value.get("goals")
        if nested is None:
            nested = [value]
        points = normalize_kpi_points(nested)
    else:
        text = str(value or "").strip()
        if not text:
            points = []
        else:
            parts = re.split(r"(?:\r?\n)+|(?:^|\s)[-*•]\s+|(?:^|\s)\d+[.、)]\s+", text)
            points = [clean_kpi_point(part) for part in parts]
            if not any(points):
                points = [clean_kpi_point(text)]
    return [point for point in points if point]


def kpi_text_from_points(points):
    return "\n".join(f"{index + 1}. {point}" for index, point in enumerate(points))


def set_user_kpi(body):
    if not isinstance(body, dict):
        raise BadRequest("json body is required")
    raw_kpi = kpi_value_from_body(body)
    points = normalize_kpi_points(raw_kpi)
    if not points:
        raise BadRequest("kpi is required")
    record = {
        "kpi": kpi_text_from_points(points),
        "points": points,
        "updatedAtIso": now_iso(),
    }
    with KPI_STORE_LOCK:
        store = read_kpi_store()
        store[KPI_GLOBAL_KEY] = record
        write_kpi_store(store)
    return {
        "ok": True,
        "item": record,
    }


def get_user_kpi(user_id=None):
    with KPI_STORE_LOCK:
        store = read_kpi_store()
    record = store.get(KPI_GLOBAL_KEY) or store.get("default")
    if not record:
        return {
            "ok": True,
            "kpi": None,
            "points": [],
            "updatedAtIso": None,
        }
    if "points" not in record:
        record = {
            **record,
            "points": normalize_kpi_points(record.get("kpi")),
        }
    return {
        "ok": True,
        **record,
    }


def save_uploaded_image(category, name, data, base_url):
    category = clean_category(category)
    if not data:
        raise BadRequest("image body is required")
    if len(data) > MAX_IMAGE_UPLOAD_BYTES:
        raise BadRequest(f"image is too large, max={MAX_IMAGE_UPLOAD_BYTES}")
    if name:
        name = clean_image_name(name)
    else:
        timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        name = f"{timestamp}_{uuid.uuid4().hex[:8]}.jpg"

    path = category_dir(category, create=True) / name
    path.write_bytes(data)
    analysis_image = ensure_analysis_image(category, path)
    analysis = write_analysis(category, name, default_analysis(category, name))
    analyze_image_async(category, path, base_url)
    return {
        "ok": True,
        "category": category,
        "item": image_item(category, path, base_url),
        "analysisImage": {
            "url": analysis_image_url(category, name, base_url),
            "size": analysis_image.stat().st_size,
        },
        "analysis": analysis,
    }


class ByteBuf:
    def __init__(self):
        self.data = bytearray()

    def put_uint16(self, value):
        self.data.extend(struct.pack("<H", int(value)))
        return self

    def put_uint32(self, value):
        self.data.extend(struct.pack("<I", int(value)))
        return self

    def put_bytes(self, value):
        self.put_uint16(len(value))
        self.data.extend(value)
        return self

    def put_string(self, value):
        return self.put_bytes(str(value).encode("utf-8"))

    def put_tree_map_uint32(self, values):
        values = values or {}
        self.put_uint16(len(values))
        for key in sorted(values.keys(), key=lambda x: int(x)):
            self.put_uint16(int(key))
            self.put_uint32(int(values[key]))
        return self

    def pack(self):
        return bytes(self.data)


def generate_rtc_token(app_id, app_key, room_id, user_id, ttl_seconds=TOKEN_TTL_SECONDS):
    require_value(app_id, "RTC AppId")
    require_value(app_key, "RTC AppKey")
    if len(app_id) != 24:
        raise ConfigError("RTC AppId should be 24 chars")

    now = int(time.time())
    expire_at = now + int(ttl_seconds)
    nonce = random.SystemRandom().randint(0, 0xFFFFFFFF)
    privileges = {
        PRIV_PUBLISH_STREAM: 0,
        PRIV_PUBLISH_AUDIO_STREAM: 0,
        PRIV_PUBLISH_VIDEO_STREAM: 0,
        PRIV_PUBLISH_DATA_STREAM: 0,
        PRIV_SUBSCRIBE_STREAM: 0,
    }

    msg = (
        ByteBuf()
        .put_uint32(nonce)
        .put_uint32(now)
        .put_uint32(expire_at)
        .put_string(room_id)
        .put_string(user_id)
        .put_tree_map_uint32(privileges)
        .pack()
    )
    signature = hmac.new(app_key.encode("utf-8"), msg, hashlib.sha256).digest()
    content = ByteBuf().put_bytes(msg).put_bytes(signature).pack()
    return {
        "token": "001" + app_id + base64.b64encode(content).decode("ascii"),
        "expiresAt": expire_at,
        "issuedAt": now,
    }


def norm_query(params):
    pairs = []
    for key in sorted(params):
        encoded_key = urllib.parse.quote(str(key), safe="-_.~")
        encoded_value = urllib.parse.quote(str(params[key]), safe="-_.~")
        pairs.append(f"{encoded_key}={encoded_value}")
    return "&".join(pairs)


def hash_sha256_text(content):
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def hmac_sha256(key, content):
    if isinstance(key, str):
        key = key.encode("utf-8")
    return hmac.new(key, content.encode("utf-8"), hashlib.sha256).digest()


def volc_openapi(action, body, access_key_id, secret_key, version=VOLC_VERSION):
    require_value(access_key_id, "Volc AccessKeyId")
    require_value(secret_key, "Volc SecretAccessKey")

    method = "POST"
    path = "/"
    query = {"Action": action, "Version": version}
    body_text = json.dumps(body or {}, ensure_ascii=False, separators=(",", ":"))
    now = dt.datetime.utcnow()
    x_date = now.strftime("%Y%m%dT%H%M%SZ")
    short_date = x_date[:8]
    content_sha256 = hash_sha256_text(body_text)
    content_type = "application/json"

    signed_headers = "content-type;host;x-content-sha256;x-date"
    canonical_headers = "\n".join(
        [
            f"content-type:{content_type}",
            f"host:{VOLC_HOST}",
            f"x-content-sha256:{content_sha256}",
            f"x-date:{x_date}",
        ]
    )
    canonical_request = "\n".join(
        [
            method,
            path,
            norm_query(query),
            canonical_headers,
            "",
            signed_headers,
            content_sha256,
        ]
    )
    credential_scope = "/".join([short_date, VOLC_REGION, VOLC_SERVICE, "request"])
    string_to_sign = "\n".join(
        [
            "HMAC-SHA256",
            x_date,
            credential_scope,
            hash_sha256_text(canonical_request),
        ]
    )
    k_date = hmac_sha256(secret_key, short_date)
    k_region = hmac_sha256(k_date, VOLC_REGION)
    k_service = hmac_sha256(k_region, VOLC_SERVICE)
    k_signing = hmac_sha256(k_service, "request")
    signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        "HMAC-SHA256 "
        f"Credential={access_key_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )

    url = f"https://{VOLC_HOST}{path}?{norm_query(query)}"
    req = urllib.request.Request(
        url=url,
        method=method,
        data=body_text.encode("utf-8"),
        headers={
            "Host": VOLC_HOST,
            "Content-Type": content_type,
            "X-Date": x_date,
            "X-Content-Sha256": content_sha256,
            "Authorization": authorization,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            text = response.read().decode("utf-8")
            return response.status, json.loads(text or "{}")
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = {"raw": text}
        return e.code, payload


def normalize_voice_chat_scenario(value):
    scenario = str(value or "").strip().lower()
    if scenario in ONBOARDING_SCENARIOS:
        return "onboarding"
    if scenario in KPI_FIX_SCENARIOS:
        return "kpi_fix"
    return ""


def apply_custom_voice_chat_config(voice_chat, llm_config, welcome_message):
    config = voice_chat.setdefault("Config", {})
    config["LLMConfig"] = copy.deepcopy(llm_config)
    agent = voice_chat.setdefault("AgentConfig", {})
    agent["WelcomeMessage"] = welcome_message
    return voice_chat


def apply_onboarding_voice_chat_config(voice_chat):
    apply_custom_voice_chat_config(voice_chat, ONBOARDING_LLM_CONFIG, ONBOARDING_WELCOME_MESSAGE)
    return voice_chat


def apply_kpi_fix_voice_chat_config(voice_chat):
    apply_custom_voice_chat_config(voice_chat, KPI_FIX_LLM_CONFIG, KPI_FIX_WELCOME_MESSAGE)
    return voice_chat


def make_session(room_id=None, user_id=None, start_ai=False, scenario=""):
    scene = load_scene()
    cfg = get_configs(scene)
    scenario = normalize_voice_chat_scenario(scenario)
    app_id = require_value(cfg["app_id"], "RTC AppId")
    app_key = require_value(cfg["app_key"], "RTC AppKey")
    room_id = room_id or cfg["rtc"].get("RoomId") or f"rokid-{uuid.uuid4().hex[:12]}"
    user_id = user_id or cfg["rtc"].get("UserId") or f"rokid-user-{uuid.uuid4().hex[:8]}"
    token_info = generate_rtc_token(app_id, app_key, room_id, user_id)
    result = {
        "appId": app_id,
        "roomId": room_id,
        "userId": user_id,
        "token": token_info["token"],
        "issuedAt": token_info["issuedAt"],
        "expiresAt": token_info["expiresAt"],
        "scenario": scenario or None,
    }
    if start_ai:
        result["voiceChat"] = start_voice_chat(room_id, user_id, scenario)
    return result


def build_voice_chat_body(scene, room_id, user_id, scenario=""):
    cfg = get_configs(scene)
    scenario = normalize_voice_chat_scenario(scenario)
    voice_chat = copy.deepcopy(scene.get("VoiceChat") or {})
    if not voice_chat:
        raise ConfigError("VoiceChat config is required to start AI")
    if scenario == "onboarding":
        apply_onboarding_voice_chat_config(voice_chat)
    elif scenario == "kpi_fix":
        apply_kpi_fix_voice_chat_config(voice_chat)
    voice_chat["AppId"] = voice_chat.get("AppId") or cfg["app_id"]
    voice_chat["RoomId"] = room_id
    voice_chat["TaskId"] = voice_chat.get("TaskId") or f"task-{uuid.uuid4().hex[:16]}"
    agent = voice_chat.setdefault("AgentConfig", {})
    target_users = agent.get("TargetUserId")
    if isinstance(target_users, list) and target_users:
        target_users[0] = user_id
    else:
        agent["TargetUserId"] = [user_id]
    return voice_chat


def start_voice_chat(room_id, user_id, scenario=""):
    scene = load_scene()
    cfg = get_configs(scene)
    scenario = normalize_voice_chat_scenario(scenario)
    body = build_voice_chat_body(scene, room_id, user_id, scenario)
    status, payload = volc_openapi(
        "StartVoiceChat",
        body,
        cfg["access_key_id"],
        cfg["secret_key"],
    )
    return {
        "httpStatus": status,
        "request": {
            "appId": body.get("AppId"),
            "roomId": body.get("RoomId"),
            "taskId": body.get("TaskId"),
            "targetUserId": body.get("AgentConfig", {}).get("TargetUserId"),
            "agentUserId": body.get("AgentConfig", {}).get("UserId"),
            "scenario": scenario or None,
            "welcomeMessage": body.get("AgentConfig", {}).get("WelcomeMessage"),
            "llmMode": (body.get("Config", {}).get("LLMConfig") or {}).get("Mode"),
            "llmUrl": (body.get("Config", {}).get("LLMConfig") or {}).get("Url"),
        },
        "response": payload,
    }


def stop_voice_chat(room_id, task_id):
    scene = load_scene()
    cfg = get_configs(scene)
    app_id = require_value(cfg["app_id"], "RTC AppId")
    body = {
        "AppId": app_id,
        "RoomId": require_value(room_id, "RoomId"),
        "TaskId": require_value(task_id, "TaskId"),
    }
    status, payload = volc_openapi(
        "StopVoiceChat",
        body,
        cfg["access_key_id"],
        cfg["secret_key"],
    )
    return {"httpStatus": status, "response": payload}


def config_status():
    try:
        scene = load_scene()
        cfg = get_configs(scene)
        voice_chat = scene.get("VoiceChat") or {}
        return {
            "configPath": str(CONFIG_PATH),
            "rtcConfigured": bool(cfg["app_id"] and cfg["app_key"]),
            "openApiConfigured": bool(cfg["access_key_id"] and cfg["secret_key"]),
            "voiceChatConfigured": bool(voice_chat),
            "imageLLMConfigured": bool(IMAGE_LLM_API_KEY),
            "imageLLMProvider": IMAGE_LLM_PROVIDER,
            "imageLLMMessagesUrl": IMAGE_LLM_MESSAGES_URL,
            "imageLLMModel": IMAGE_LLM_MODEL,
            "glassesCameraEnabled": GLASSES_CAMERA_ENABLED,
            "appIdTail": cfg["app_id"][-6:] if cfg["app_id"] else "",
            "defaultRoomId": cfg["rtc"].get("RoomId", ""),
            "defaultUserId": cfg["rtc"].get("UserId", ""),
            "voiceChatAgentUserId": (voice_chat.get("AgentConfig") or {}).get("UserId", ""),
        }
    except Exception as e:
        return {
            "configPath": str(CONFIG_PATH),
            "error": str(e),
            "rtcConfigured": False,
            "openApiConfigured": False,
            "voiceChatConfigured": False,
            "glassesCameraEnabled": GLASSES_CAMERA_ENABLED,
        }


def glasses_config(query=None):
    query = query or {}
    device_id = query.get("deviceId") or query.get("device_id") or ""
    if device_id and not DEVICE_ID_PATTERN.match(device_id):
        raise BadRequest("invalid deviceId")
    return {
        "ok": True,
        "deviceId": device_id,
        "cameraEnabled": GLASSES_CAMERA_ENABLED,
    }


def parse_bool(value):
    if isinstance(value, bool):
        return value
    return str(value).lower() in {"1", "true", "yes", "y", "on"}


class Handler(BaseHTTPRequestHandler):
    server_version = "RokidVolcRtcBackend/0.1"

    def log_message(self, fmt, *args):
        sys.stdout.write("%s %s\n" % (self.log_date_time_string(), fmt % args))
        sys.stdout.flush()

    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-Filename")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_sse_event(self, event_type, payload):
        self.wfile.write(sse_payload(event_type, payload))
        self.wfile.flush()

    def send_glasses_events(self, device_id, category):
        device_id = clean_device_id(device_id)
        category = clean_category(category or DEFAULT_IMAGE_CATEGORY)
        client_id, client_queue = register_sse_client(device_id)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        last_status_key = ""
        last_ping_at = 0.0
        try:
            self.send_sse_event("hello", {
                "ok": True,
                "deviceId": device_id,
                "category": category,
                "connectedAtIso": now_iso(),
            })
            initial_status = client_status(category, self.base_url())
            self.send_sse_event("status", initial_status)
            last_status_key = status_event_key(initial_status)

            while True:
                now = time.time()
                try:
                    event = client_queue.get(timeout=1.0)
                    event_type = event.get("event", "message")
                    event_payload = event.get("payload") or {}
                    if event_type == "__close":
                        break
                    self.send_sse_event(event_type, event_payload)
                    if event_type == "status":
                        last_status_key = status_event_key(event_payload)
                except queue.Empty:
                    pass

                status = client_status(category, self.base_url())
                status_key = status_event_key(status)
                if status_key and status_key != last_status_key:
                    self.send_sse_event("status", status)
                    last_status_key = status_key

                if now - last_ping_at >= 15:
                    self.send_sse_event("ping", {"ts": int(now), "serverTimeIso": now_iso()})
                    last_ping_at = now
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            unregister_sse_client(client_id)

    def send_image_file(self, path):
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        stat = path.stat()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(stat.st_size))
        self.end_headers()
        with path.open("rb") as f:
            while True:
                chunk = f.read(1024 * 256)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def send_static_file(self, path, content_type=None):
        path = Path(path)
        stat = path.stat()
        data_type = content_type or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", data_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(stat.st_size))
        self.end_headers()
        with path.open("rb") as f:
            while True:
                chunk = f.read(1024 * 256)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def send_group_chat_avatar(self, name):
        safe_name = str(name or "牛马云").strip()[:12] or "牛马云"
        initial = html.escape(safe_name[:1])
        label = html.escape(safe_name)
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'
            '<rect width="96" height="96" rx="24" fill="#1f6feb"/>'
            '<circle cx="72" cy="24" r="12" fill="#ffcc33"/>'
            f'<text x="48" y="57" text-anchor="middle" font-size="34" font-family="Arial, sans-serif" '
            f'font-weight="700" fill="#ffffff">{initial}</text>'
            f'<title>{label}</title>'
            '</svg>'
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "max-age=86400")
        self.send_header("Content-Length", str(len(svg)))
        self.end_headers()
        self.wfile.write(svg)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def read_body_bytes(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            raise BadRequest("request body is required")
        if length > MAX_IMAGE_UPLOAD_BYTES:
            raise BadRequest(f"request body is too large, max={MAX_IMAGE_UPLOAD_BYTES}")
        return self.rfile.read(length)

    def base_url(self):
        proto = self.headers.get("X-Forwarded-Proto") or "http"
        host = self.headers.get("Host") or f"www.yhaox.top:{PORT}"
        return f"{proto}://{host}"

    def do_OPTIONS(self):
        self.send_json(200, {"ok": True})

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            query = {k: v[-1] for k, v in urllib.parse.parse_qs(parsed.query).items()}
            if parsed.path in {"/control", "/control.html"}:
                self.send_static_file(CONTROL_HTML_PATH, "text/html; charset=utf-8")
                return
            if parsed.path == "/health":
                self.send_json(200, {"ok": True, "service": "rokid-volc-rtc", "port": PORT})
                return
            if parsed.path == "/config/status":
                self.send_json(200, config_status())
                return
            if parsed.path == "/glasses/config":
                self.send_json(200, glasses_config(query))
                return
            if parsed.path == "/glasses/events":
                self.send_glasses_events(
                    query.get("deviceId") or "rokid-glasses-001",
                    query.get("category") or DEFAULT_IMAGE_CATEGORY,
                )
                return
            if parsed.path == "/client/status":
                self.send_json(200, client_status(
                    query.get("category") or DEFAULT_IMAGE_CATEGORY,
                    self.base_url(),
                ))
                return
            if parsed.path == "/group-chat/messages":
                self.send_json(200, list_group_chat_messages(
                    query.get("groupId") or query.get("group_id") or GROUP_CHAT_DEFAULT_ID
                ))
                return
            if parsed.path == "/group-chat/mock":
                self.send_json(200, insert_mock_group_chat_message(query=query, base_url=self.base_url()))
                return
            if parsed.path == "/group-chat/avatar":
                self.send_group_chat_avatar(query.get("name"))
                return
            if parsed.path == "/glasses/rtc/exit":
                self.send_json(410, request_glasses_rtc_exit(query=query))
                return
            if parsed.path == "/glasses/onboarding/start":
                self.send_json(200, request_onboarding_training_start(query=query))
                return
            if parsed.path in {"/tts/voice", "/glasses/tts/voice"}:
                self.send_json(200, get_tts_voice())
                return
            if parsed.path in {"/kpi", "/user/kpi"}:
                self.send_json(200, get_user_kpi())
                return
            if parsed.path in {"/screenshots/latest", "/screenshot/latest"}:
                self.send_json(200, latest_screenshot(self.base_url()))
                return
            if parsed.path in {"/screenshots/latest-file", "/screenshot/latest-file"}:
                self.send_image_file(latest_screenshot_path())
                return
            if parsed.path in {"/screenshots/file", "/screenshot/file"}:
                self.send_image_file(screenshot_file_path(query.get("name")))
                return
            if parsed.path in {"/personal-images/latest", "/personal-image/latest"}:
                self.send_json(200, latest_personal_image(self.base_url()))
                return
            if parsed.path in {"/personal-images/latest-file", "/personal-image/latest-file"}:
                self.send_image_file(latest_storage_image_path(PERSONAL_IMAGE_ROOT))
                return
            if parsed.path in {"/personal-images/file", "/personal-image/file"}:
                self.send_image_file(storage_image_file_path(PERSONAL_IMAGE_ROOT, query.get("name")))
                return
            if parsed.path in {"/personal-images/generated/latest", "/personal-image/generated/latest"}:
                self.send_json(200, latest_generated_image(self.base_url()))
                return
            if parsed.path in {"/personal-images/generated/latest-file", "/personal-image/generated/latest-file"}:
                self.send_image_file(latest_storage_image_path(GENERATED_IMAGE_ROOT))
                return
            if parsed.path in {"/personal-images/generated/file", "/personal-image/generated/file"}:
                self.send_image_file(storage_image_file_path(GENERATED_IMAGE_ROOT, query.get("name")))
                return
            if parsed.path == "/images":
                self.send_json(200, list_images(query.get("category"), self.base_url()))
                return
            if parsed.path == "/images/analysis-file":
                category = clean_category(query.get("category"))
                name = clean_image_name(query.get("name"))
                self.send_image_file(analysis_image_file_path(category, name))
                return
            if parsed.path == "/images/file":
                category = clean_category(query.get("category"))
                name = clean_image_name(query.get("name"))
                self.send_image_file(image_file_path(category, name))
                return
            if parsed.path == "/rtc/session":
                payload = make_session(
                    room_id=query.get("room_id") or query.get("roomId"),
                    user_id=query.get("user_id") or query.get("userId"),
                    start_ai=parse_bool(query.get("start_ai") or query.get("startAi") or False),
                    scenario=query.get("scenario") or query.get("voiceChatScenario"),
                )
                self.send_json(200, payload)
                return
            self.send_json(404, {"ok": False, "error": "not found"})
        except BadRequest as e:
            self.send_json(400, {"ok": False, "error": str(e)})
        except FileNotFoundError as e:
            self.send_json(404, {"ok": False, "error": f"image not found: {e}"})
        except ConfigError as e:
            self.send_json(503, {"ok": False, "error": str(e), "config": config_status()})
        except Exception as e:
            traceback.print_exc()
            self.send_json(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            query = {k: v[-1] for k, v in urllib.parse.parse_qs(parsed.query).items()}
            if parsed.path == "/images/upload":
                name = query.get("name") or self.headers.get("X-Filename") or ""
                self.send_json(200, save_uploaded_image(
                    query.get("category"),
                    name,
                    self.read_body_bytes(),
                    self.base_url(),
                ))
                return
            if parsed.path in {"/screenshots/upload", "/screenshot/upload"}:
                name = query.get("name") or self.headers.get("X-Filename") or ""
                self.send_json(200, save_uploaded_screenshot(
                    name,
                    self.read_body_bytes(),
                    self.base_url(),
                ))
                return
            if parsed.path in {"/personal-images/upload", "/personal-image/upload"}:
                name = query.get("name") or self.headers.get("X-Filename") or ""
                prompt = query.get("prompt") or self.headers.get("X-Prompt") or ""
                device_id = (
                    query.get("deviceId")
                    or query.get("targetDeviceId")
                    or self.headers.get("X-Device-Id")
                    or self.headers.get("X-Target-Device-Id")
                    or TRANSITION_TTS_DEVICE_ID
                )
                self.send_json(200, save_personal_image_and_generate(
                    name,
                    self.read_body_bytes(),
                    prompt,
                    self.base_url(),
                    device_id,
                ))
                return
            if parsed.path == "/app/status":
                body = self.read_json()
                self.send_json(200, app_status(
                    body.get("category") or query.get("category") or DEFAULT_IMAGE_CATEGORY,
                    self.base_url(),
                ))
                return
            if parsed.path == "/glasses/command":
                self.send_json(200, send_glasses_command(self.read_json()))
                return
            if parsed.path == "/group-chat/mock":
                self.send_json(200, insert_mock_group_chat_message(self.read_json(), query, self.base_url()))
                return
            if parsed.path == "/glasses/rtc/exit":
                self.send_json(410, request_glasses_rtc_exit(self.read_json(), query))
                return
            if parsed.path == "/glasses/onboarding/start":
                self.send_json(200, request_onboarding_training_start(self.read_json(), query))
                return
            if parsed.path in {"/tts/voice", "/glasses/tts/voice"}:
                self.send_json(200, set_tts_voice(self.read_json(), query))
                return
            if parsed.path in {"/kpi", "/user/kpi"}:
                self.send_json(200, set_user_kpi(self.read_json()))
                return

            if parsed.path == "/rtc/session":
                body = self.read_json()
                payload = make_session(
                    room_id=body.get("roomId") or body.get("room_id"),
                    user_id=body.get("userId") or body.get("user_id"),
                    start_ai=parse_bool(body.get("startAi") or body.get("start_ai") or False),
                    scenario=body.get("scenario") or body.get("voiceChatScenario"),
                )
                self.send_json(200, payload)
                return
            if parsed.path == "/voice/start":
                body = self.read_json()
                payload = start_voice_chat(
                    room_id=body.get("roomId") or body.get("room_id"),
                    user_id=body.get("userId") or body.get("user_id"),
                    scenario=body.get("scenario") or body.get("voiceChatScenario"),
                )
                self.send_json(200, payload)
                return
            if parsed.path == "/voice/stop":
                body = self.read_json()
                payload = stop_voice_chat(
                    room_id=body.get("roomId") or body.get("room_id"),
                    task_id=body.get("taskId") or body.get("task_id"),
                )
                self.send_json(200, payload)
                return
            if parsed.path == "/images/clear":
                body = self.read_json()
                self.send_json(200, clear_images(body.get("category")))
                return
            self.send_json(404, {"ok": False, "error": "not found"})
        except BadRequest as e:
            self.send_json(400, {"ok": False, "error": str(e)})
        except ConfigError as e:
            self.send_json(503, {"ok": False, "error": str(e), "config": config_status()})
        except Exception as e:
            traceback.print_exc()
            self.send_json(500, {"ok": False, "error": str(e)})

    def do_DELETE(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            query = {k: v[-1] for k, v in urllib.parse.parse_qs(parsed.query).items()}
            if parsed.path == "/images":
                self.send_json(200, clear_images(query.get("category")))
                return
            self.send_json(404, {"ok": False, "error": "not found"})
        except BadRequest as e:
            self.send_json(400, {"ok": False, "error": str(e)})
        except Exception as e:
            traceback.print_exc()
            self.send_json(500, {"ok": False, "error": str(e)})


def main():
    load_dotenv()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"rokid-volc-rtc backend listening on 0.0.0.0:{PORT}")
    print(f"scene config: {CONFIG_PATH}")
    sys.stdout.flush()
    server.serve_forever()


if __name__ == "__main__":
    main()

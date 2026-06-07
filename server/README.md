# Rokid Volc RTC Backend

This is a tiny backend for the Rokid glasses RTC experiment.

It does three things:

- Generates Volc RTC room tokens from `AppId`, `AppKey`, `RoomId`, and `UserId`.
- Starts a Volc `StartVoiceChat` AI bot in the same RTC room.
- Keeps Volc AK/SK and RTC AppKey out of the Android APK.

## Config

Copy `config/scene.example.json` to `config/scene.json`, then fill:

- `AccountConfig.accessKeyId`
- `AccountConfig.secretKey`
- `RTCConfig.AppId`
- `RTCConfig.AppKey`
- `VoiceChat.AgentConfig.UserId`
- `VoiceChat.Config.ASRConfig.ProviderParams.AppId`
- `VoiceChat.Config.TTSConfig.ProviderParams.app.appid`
- `VoiceChat.Config.LLMConfig.EndPointId`

The `VoiceChat` block matches the official Volc RTC AIGC demo scene format.

## Run

```bash
python volc_rtc_backend.py
```

Default port: `18091`.

## Endpoints

```text
GET  /health
GET  /config/status
GET  /rtc/session?start_ai=0
POST /rtc/session
POST /voice/start
POST /voice/stop
POST /app/status
GET  /client/status?category=rokid
GET  /glasses/events?deviceId=rokid-glasses-001&category=rokid
POST /glasses/command
GET  /images?category=demo
GET  /images/file?category=demo&name=20260606_003043.jpg
GET  /images/analysis-file?category=demo&name=20260606_003043.jpg
POST /images/upload?category=demo&name=20260606_003043.jpg
POST /images/clear
DELETE /images?category=demo
```

`POST /rtc/session` body:

```json
{
  "roomId": "rokid-test-room",
  "userId": "rokid-glasses-001",
  "startAi": true
}
```

Response includes `appId`, `roomId`, `userId`, `token`, `expiresAt`, and optionally the `StartVoiceChat` response.

## Phone Image APIs

Images are stored by category under:

```text
media/images/<category>/
```

List images in a category:

```text
GET /images?category=demo
```

Response:

```json
{
  "ok": true,
  "category": "demo",
  "count": 1,
  "items": [
    {
      "id": "20260606_003043.jpg",
      "filename": "20260606_003043.jpg",
      "url": "http://www.yhaox.top:18091/images/file?category=demo&name=20260606_003043.jpg",
      "size": 845125,
      "modifiedAt": 1780677043.0,
      "modifiedAtIso": "2026-06-05T16:30:43+00:00"
    }
  ]
}
```

Upload one image into a category. The request body is the raw image bytes:

```http
POST /images/upload?category=demo&name=20260606_003043.jpg
Content-Type: image/jpeg
```

Response:

```json
{
  "ok": true,
  "category": "demo",
  "item": {
    "id": "20260606_003043.jpg",
    "filename": "20260606_003043.jpg",
    "url": "http://www.yhaox.top:18091/images/file?category=demo&name=20260606_003043.jpg",
    "size": 845125,
    "modifiedAt": 1780677043.0,
    "modifiedAtIso": "2026-06-05T16:30:43+00:00"
  },
  "analysisImage": {
    "url": "http://www.yhaox.top:18091/images/analysis-file?category=demo&name=20260606_003043.jpg",
    "size": 12064
  }
}
```

After upload, the backend keeps the original image for phone display and creates
a low-resolution JPEG for image scene analysis. The Anthropic-compatible image
LLM endpoint sees only the low-res analysis image. Defaults:

```text
ROKID_ANALYSIS_IMAGE_MAX_WIDTH=480
ROKID_ANALYSIS_IMAGE_MAX_HEIGHT=480
ROKID_ANALYSIS_IMAGE_JPEG_QUALITY=85
IMAGE_LLM_MESSAGES_URL=https://api.zhizengzeng.com/anthropic/v1/messages
IMAGE_LLM_MODEL=mimo-v2.5
```

For a portrait Rokid frame, this typically produces a `270x480` image. For a
landscape frame, it typically produces `480x270`.

Query the latest completed LLM state for the C-side UI:

```http
GET /client/status?category=rokid
```

This endpoint is separate from the original upload/status APIs. It does not
return the newest uploaded frame. It returns the latest completed LLM state and
the exact low-resolution frame that was sent to the LLM for that state.

```json
{
  "ok": true,
  "category": "rokid",
  "state": "看电脑",
  "scene": "看电脑",
  "analysisStatus": "done",
  "confidence": 0.86,
  "reason": "画面主体是电脑屏幕和桌面环境",
  "evidence": ["电脑屏幕", "桌面办公环境"],
  "imageUrl": "http://www.yhaox.top:18091/images/analysis-file?category=rokid&name=20260606_092000.jpg",
  "filename": "20260606_092000.jpg",
  "updatedAtIso": "2026-06-06T09:20:04+00:00"
}
```

## Glasses Event Stream

The glasses app keeps one long-lived SSE connection:

```http
GET /glasses/events?deviceId=rokid-glasses-001&category=rokid
Accept: text/event-stream
```

The server sends:

```text
event: status
data: {"scene":"看电脑","analysisStatus":"done","filename":"xxx.jpg","sceneLabels":["看电脑","看手机","摸鱼","和朋友聊天","写东西","一个人的默认","老板交流","老板约谈"]}

event: command
data: {"type":"boss_talk","text":"找老板谈话"}

event: ping
data: {"ts":1780717200}
```

Push a command to connected glasses:

```http
POST /glasses/command
Content-Type: application/json

{"deviceId":"rokid-glasses-001","type":"boss_talk","text":"找老板谈话"}
```

The original nested status API is also available:

```http
POST /app/status
Content-Type: application/json

{"category":"rokid"}
```

Response:

```json
{
  "ok": true,
  "category": "rokid",
  "scene": "看电脑",
  "analysisStatus": "done",
  "image": {
    "filename": "20260606_092000.jpg",
    "url": "http://www.yhaox.top:18091/images/file?category=rokid&name=20260606_092000.jpg"
  },
  "analysis": {
    "scene": "看电脑",
    "confidence": 0.86,
    "reason": "画面主体是电脑屏幕和桌面环境",
    "evidence": ["电脑屏幕", "桌面办公环境"]
  },
  "sceneLabels": [
    "看电脑",
    "看手机",
    "摸鱼",
    "和朋友聊天",
    "写东西",
    "一个人的默认",
    "老板交流",
    "老板约谈"
  ]
}
```

If `IMAGE_LLM_API_KEY` is not configured, `analysisStatus` returns `missing_config`
and `scene` falls back to `一个人的默认`.

Clear images in a category:

```http
POST /images/clear
Content-Type: application/json

{"category":"demo"}
```

or:

```text
DELETE /images?category=demo
```

## MiniMax Pixel I2V

`minimax_pixel_i2v.py` builds the portrait-to-video chain for the hackathon demo:

1. Reads the local portrait reference, defaulting to `/Users/mi/Downloads/人像.jpg`.
2. Uses MiniMax image generation to create a pixel-art first frame where the person wears black smart AI glasses.
3. Pixelates that first frame locally with nearest-neighbor scaling so the video input is visibly pixel style.
4. Downloads the 6s result.

MiniMax's current image-to-video API supports 6s or 10s raw video for the Hailuo 2.3 models. This script defaults to 6s and only trims locally if you explicitly pass a shorter `--target-seconds`.

Configure:

```bash
cp backend/.env.example backend/.env
```

Then set:

```text
MINIMAX_API_KEY=your_api_key
```

Run:

```bash
python3 backend/minimax_pixel_i2v.py
```

Useful options:

```bash
python3 backend/minimax_pixel_i2v.py --target-seconds 3
python3 backend/minimax_pixel_i2v.py --image /Users/mi/Downloads/人像.jpg
python3 backend/minimax_pixel_i2v.py --skip-first-frame-prep
python3 backend/minimax_pixel_i2v.py --no-local-pixelate
python3 backend/minimax_pixel_i2v.py --dry-run
```

Outputs are written to:

```text
backend/media/videos/<timestamp>/
```

The final short clip is named like:

```text
raw_6s.mp4
```

## Qiniu Kling Image Test

`qiniu_kling_image_test.py` runs a local Qiniu Kling image-to-image test with the latest frame reference:

```text
/Users/mi/Downloads/图片帧最新.jpg
```

It uses:

```text
POST /v1/images/generations
GET  /v1/images/tasks/<task_id>
```

Configure the key in the shell or `backend/.env`:

```bash
export QNAIGC_API_KEY=your_api_key
```

Run:

```bash
python3 backend/qiniu_kling_image_test.py
```

Outputs are written to:

```text
backend/media/qiniu_image_tests/<timestamp>/
```

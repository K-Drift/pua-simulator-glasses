# Rokid 眼镜端 · Android

Rokid 眼镜端 Android Demo，用于拍照上传、状态轮询、TTS 播报和 RTC 老板对话链路。

## 构建

```bash
# 通过 -P 传入 TTS 密钥（也可走环境变量 / 全局 gradle.properties）
./gradlew :app:assembleDebug -PROKID_TTS_API_KEY=你的TTS密钥
```

## 安装

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 说明

- 后端地址与 TTS 密钥由 `BuildConfig` 注入（取自 gradle 属性 `ROKID_TTS_API_KEY` / `ROKID_BACKEND_BASE_URL`），不写死在源码里。
- Maven 仓库已在 `settings.gradle.kts` 中配置 Rokid 与 Volcengine 源。
- 当前只保留眼镜端工程，不包含云端后端、录音、照片、视频和本地构建产物。


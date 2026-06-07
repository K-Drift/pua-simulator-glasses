plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.rokidaudiodemo"
    compileSdk = 34

    // 密钥 / 部署相关常量从外部读取，不再硬编码进源码或提交进仓库。
    // 优先级：-P 命令行参数 > gradle.properties / ~/.gradle/gradle.properties > 环境变量 > 空。
    // 例：./gradlew assembleDebug -PROKID_TTS_API_KEY=xxxx
    fun secret(name: String, fallback: String = ""): String =
        (project.findProperty(name) as String?) ?: System.getenv(name) ?: fallback

    defaultConfig {
        applicationId = "com.example.rokidaudiodemo"
        minSdk = 23
        targetSdk = 28
        versionCode = 1
        versionName = "0.1.0"
        ndk {
            abiFilters += listOf("arm64-v8a")
        }

        buildConfigField("String", "TTS_API_KEY", "\"${secret("ROKID_TTS_API_KEY")}\"")
        buildConfigField(
            "String",
            "BACKEND_BASE_URL",
            "\"${secret("ROKID_BACKEND_BASE_URL", "http://www.yhaox.top:18091")}\"",
        )
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.volcengine:VolcEngineRTC:3.60.104.300")
    implementation("androidx.activity:activity:1.8.2")
    implementation("androidx.camera:camera-core:1.4.2")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
}

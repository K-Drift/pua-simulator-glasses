pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven("https://maven.rokid.com/repository/maven-public/")
        maven("https://artifact.bytedance.com/repository/Volcengine/")
    }
}

rootProject.name = "RokidAudioDemo"
include(":app")

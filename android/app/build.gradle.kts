plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.kerai.omniai"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.kerai.omniai"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            // Left unminified deliberately: there is no third-party code to shrink, and an
            // unobfuscated build is far easier to debug when a WebView permission misbehaves.
            isMinifyEnabled = false
            // Signed with the debug key so `assembleRelease` produces an installable APK
            // without a keystore. Replace before distributing this anywhere.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

// No dependencies on purpose. The app uses android.app.Activity and the platform WebView
// rather than AndroidX, which keeps the APK tiny and lets it build with nothing downloaded.
dependencies {}

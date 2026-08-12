// Versions pinned to what is already in the local Gradle cache (AGP 8.13.2, Kotlin 2.2.20)
// so a build needs no network access.
plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
}

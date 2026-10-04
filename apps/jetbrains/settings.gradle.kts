rootProject.name = "piwi-jetbrains"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

plugins {
    // Downloads the JDK 21 the build compiles with (jvmToolchain) when the machine has none, and gives
    // updateDaemonJvm the download links it writes into gradle/gradle-daemon-jvm.properties.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

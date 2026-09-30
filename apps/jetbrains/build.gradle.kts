import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.VerifyPluginTask
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.2.21"
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "dev.piwitests"
version = providers.gradleProperty("pluginVersion").get()

// The editor service every client ships, built by `npm run editor:build`.
val languageServer = layout.projectDirectory.file("../../packages/editor/dist/piwi-language-server.cjs")

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

// Built with JDK 21, as bytecode for Java 17: the runtime of the oldest supported platform.
kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        // The oldest supported platform (2023.3) bundles Kotlin 1.9.
        apiVersion.set(KotlinVersion.KOTLIN_1_9)
        languageVersion.set(KotlinVersion.KOTLIN_1_9)
    }
}

// Platform classes newer than the oldest supported platform, as later platforms declare them:
// compiled against, never packaged. The plugin reaches them only where the platform has them.
val platformStubs: SourceSet = sourceSets.create("platformStubs") {
    compileClasspath = configurations.compileClasspath.get()
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    intellijPlatform {
        create(providers.gradleProperty("platformType"), providers.gradleProperty("platformVersion"))
        bundledPlugin("JavaScript")
        testFramework(TestFrameworkType.Platform)
    }
}

intellijPlatform {
    pluginConfiguration {
        version = providers.gradleProperty("pluginVersion")
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            untilBuild = provider { null }
        }
    }
    signing {
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }
    publishing {
        token = providers.environmentVariable("PUBLISH_TOKEN")
    }
    // `verifyIdes` lists `<type code>:<version>` pairs, comma-separated; each IDE is a large download.
    pluginVerification {
        // The Language Services widget's class, absent from the oldest supported platform, which never calls
        // the method that names it: see platformStubs.
        ignoredProblemsFile = layout.projectDirectory.file("verifier-ignored-problems.txt")
        failureLevel = listOf(
            VerifyPluginTask.FailureLevel.COMPATIBILITY_PROBLEMS,
            VerifyPluginTask.FailureLevel.INVALID_PLUGIN,
        )
        ides {
            providers.gradleProperty("verifyIdes").get().split(",").map { it.trim() }.filter { it.isNotEmpty() }.forEach {
                val (type, ideVersion) = it.split(":")
                create(IntelliJPlatformType.fromCode(type), ideVersion)
            }
        }
    }
    buildSearchableOptions = false
}

tasks {
    withType<JavaCompile> {
        options.release.set(17)
    }
    withType<org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile> {
        compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
    }
    named<org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile>("compileKotlin") {
        libraries.from(platformStubs.output)
    }
    prepareSandbox {
        from(languageServer) {
            into(pluginName.map { "$it/server" })
        }
    }
    test {
        systemProperty("piwi.editor.server", languageServer.asFile.absolutePath)
    }
}

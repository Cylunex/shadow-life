plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

extra["lifeEmbeddedHost"] = false
apply(from = rootProject.file("gradle/life-config.gradle"))

android {
    namespace = "com.shadow.life.standalone"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.shadow.life"
        minSdk = 29
        targetSdk = 36
        versionCode = 94
        versionName = "2.1.72"
        @Suppress("UNCHECKED_CAST")
        manifestPlaceholders.putAll(project.extra["lifeManifestConfig"] as Map<String, String>)
    }
    // The existing source paths are shared with the embedded library and compiled once per host.
    sourceSets {
        getByName("main") {
            java.setSrcDirs(emptyList<String>())
            res.setSrcDirs(listOf("src/standalone/res"))
            assets.setSrcDirs(emptyList<String>())
        }
        getByName("debug").java.setSrcDirs(emptyList<String>())
        getByName("test").java.setSrcDirs(emptyList<String>())
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin { jvmToolchain(17) }
dependencies {
    implementation(project(":embedded"))
    (project.extra["lifeSamsungAar"] as File?)?.let { implementation(files(it)) }
}
// Keep the standalone project's verification entry points after moving compilation to the shared library.
tasks.withType<Test>().configureEach { dependsOn(":embedded:${name}") }
tasks.matching { it.name == "lintDebug" || it.name == "lintRelease" }.configureEach { dependsOn(":embedded:${name}") }

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("kotlin-parcelize")
}

group = "com.shadow.life"
val hosted = gradle.parent != null
extra["lifeEmbeddedHost"] = hosted
if (hosted) layout.buildDirectory.set(rootProject.layout.buildDirectory.dir("hosted-life"))
apply(from = rootProject.file("gradle/life-config.gradle"))
val samsungHealthAar = extra["lifeSamsungAar"] as File?
val lifeApp = rootProject.file("app")
android {
    namespace = "com.shadow.life"
    compileSdk = 36
    defaultConfig {
        minSdk = 29
        @Suppress("UNCHECKED_CAST")
        val config = project.extra["lifeClientConfig"] as Map<String, String>
        config.forEach { (name, value) ->
            val escaped = value.replace("\\","\\\\").replace("\"","\\\"")
            buildConfigField("String", name, "\"$escaped\"")
        }
        buildConfigField("boolean", "HEALTH_CONNECT_ENABLED", project.extra["lifeHealthEnabled"] as String)
        buildConfigField("boolean", "SAMSUNG_HEALTH_DATA_AVAILABLE", (samsungHealthAar != null).toString())
        @Suppress("UNCHECKED_CAST")
        manifestPlaceholders.putAll(project.extra["lifeManifestConfig"] as Map<String, String>)
    }
    sourceSets {
        getByName("main") {
            java.srcDir(lifeApp.resolve("src/main/java"))
            res.srcDir(lifeApp.resolve("src/main/res"))
            assets.srcDirs(lifeApp.resolve("src/main/assets"), rootProject.file("../features"))
            if (samsungHealthAar != null) java.srcDir(lifeApp.resolve("src/samsung/kotlin"))
        }
        getByName("debug").java.srcDir(lifeApp.resolve("src/debug/java"))
        getByName("test").java.srcDir(lifeApp.resolve("src/test/java"))
    }
    buildFeatures { compose = true; buildConfig = true }
    testOptions { unitTests.isIncludeAndroidResources = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin { jvmToolchain(17) }
dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:data"))
    implementation(project(":core:designsystem"))
    implementation(project(":devices"))
    implementation(platform(libs.compose.bom))
    implementation(libs.activity.compose)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons)
    implementation(libs.compose.foundation)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.navigation.compose)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.work.runtime)
    implementation(libs.browser)
    implementation(libs.health.connect)
    implementation(libs.appauth)
    implementation(libs.security.crypto)
    implementation(libs.google.maps)
    implementation(libs.amap.maps)
    if (samsungHealthAar != null) {
        compileOnly(files(samsungHealthAar))
        implementation(libs.gson)
    }
    testImplementation(libs.junit)
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("org.robolectric:robolectric:4.17")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

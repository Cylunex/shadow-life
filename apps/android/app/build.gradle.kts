plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose"); id("org.jetbrains.kotlin.plugin.serialization"); id("kotlin-parcelize") }
val samsungHealthAar=providers.gradleProperty("SAMSUNG_HEALTH_DATA_AAR").orNull?.let(::file)?.takeIf{it.isFile}
android { namespace="com.shadow.life"; compileSdk=36
  defaultConfig {
    applicationId="com.shadow.life"; minSdk=29; targetSdk=36; versionCode=25; versionName="2.1.3"
    fun configured(name:String,fallback:String)=providers.gradleProperty(name).orElse(fallback).get()
    fun quoted(value:String)="\"${value.replace("\\","\\\\").replace("\"","\\\"")}\""
    buildConfigField("String","SHADOW_API_BASE",quoted(configured("SHADOW_API_BASE","https://api.example.com")))
    buildConfigField("String","SHADOW_OIDC_ISSUER",quoted(configured("SHADOW_OIDC_ISSUER","")))
    buildConfigField("String","SHADOW_OIDC_CLIENT_ID",quoted(configured("SHADOW_OIDC_CLIENT_ID","shadow-life-android")))
    buildConfigField("String","SHADOW_OIDC_REDIRECT_URI",quoted(configured("SHADOW_OIDC_REDIRECT_URI","com.shadow.life:/oauth2redirect")))
    buildConfigField("String","SHADOW_OIDC_RESOURCE",quoted(configured("SHADOW_OIDC_RESOURCE","https://api.example.com")))
    buildConfigField("boolean","SAMSUNG_HEALTH_DATA_AVAILABLE",(samsungHealthAar!=null).toString())
    manifestPlaceholders["appAuthRedirectScheme"]=configured("SHADOW_OIDC_REDIRECT_SCHEME","com.shadow.life")
    manifestPlaceholders["shadowLifeAppLinkHost"]=configured("SHADOW_APP_LINK_HOST","life.example.com")
  }
  compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }
  buildFeatures { compose=true; buildConfig=true }
  if(samsungHealthAar!=null)sourceSets.getByName("main").java.srcDir("src/samsung/kotlin")
}
kotlin { jvmToolchain(17) }
dependencies {
  implementation(project(":core:model")); implementation(project(":core:data")); implementation(project(":core:designsystem")); implementation(project(":devices"))
  implementation(platform(libs.compose.bom)); implementation(libs.activity.compose); implementation(libs.compose.material3); implementation(libs.compose.icons); implementation(libs.compose.foundation); implementation(libs.lifecycle.viewmodel.compose); implementation(libs.lifecycle.runtime.compose); implementation(libs.navigation.compose); implementation(libs.kotlinx.serialization.json)
  implementation(libs.work.runtime)
  implementation(libs.browser)
  implementation(libs.health.connect)
  implementation(libs.appauth)
  implementation(libs.security.crypto)
  if(samsungHealthAar!=null){implementation(files(samsungHealthAar));implementation(libs.gson)}
}

plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose"); id("com.google.devtools.ksp") }
android { namespace="com.shadow.app"; compileSdk=36
  defaultConfig {
    applicationId="com.shadow.app"; minSdk=26; targetSdk=36; versionCode=15; versionName="1.0.0"
    fun configured(name:String,fallback:String)=providers.gradleProperty(name).orElse(fallback).get()
    fun quoted(value:String)="\"${value.replace("\\","\\\\").replace("\"","\\\"")}\""
    buildConfigField("String","SHADOW_API_BASE",quoted(configured("SHADOW_API_BASE","https://api.example.com")))
    buildConfigField("String","SHADOW_OIDC_ISSUER",quoted(configured("SHADOW_OIDC_ISSUER","")))
    buildConfigField("String","SHADOW_OIDC_CLIENT_ID",quoted(configured("SHADOW_OIDC_CLIENT_ID","shadow-life-android")))
    buildConfigField("String","SHADOW_OIDC_REDIRECT_URI",quoted(configured("SHADOW_OIDC_REDIRECT_URI","com.shadow.app:/oauth2redirect")))
    manifestPlaceholders["appAuthRedirectScheme"]=configured("SHADOW_OIDC_REDIRECT_SCHEME","com.shadow.app")
  }
  compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }
  buildFeatures { compose=true; buildConfig=true }
}
kotlin { jvmToolchain(17) }
ksp { arg("room.schemaLocation","$projectDir/schemas") }
dependencies {
  implementation(platform("androidx.compose:compose-bom:2025.10.01")); implementation("androidx.activity:activity-compose:1.11.0"); implementation("androidx.compose.material3:material3"); implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
  implementation("androidx.room:room-runtime:2.8.3"); implementation("androidx.room:room-ktx:2.8.3"); ksp("androidx.room:room-compiler:2.8.3"); implementation("androidx.work:work-runtime-ktx:2.10.5")
  implementation("androidx.security:security-crypto:1.1.0")
  implementation("androidx.health.connect:connect-client:1.1.0")
  implementation("net.openid:appauth:0.11.1")
}

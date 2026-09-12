plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose"); id("org.jetbrains.kotlin.plugin.serialization"); id("com.google.devtools.ksp") }
android { namespace="com.shadow.life"; compileSdk=36
  defaultConfig {
    applicationId="com.shadow.life"; minSdk=26; targetSdk=36; versionCode=20; versionName="2.0.0-dev"
    fun configured(name:String,fallback:String)=providers.gradleProperty(name).orElse(fallback).get()
    fun quoted(value:String)="\"${value.replace("\\","\\\\").replace("\"","\\\"")}\""
    buildConfigField("String","SHADOW_API_BASE",quoted(configured("SHADOW_API_BASE","https://api.example.com")))
    buildConfigField("String","SHADOW_OIDC_ISSUER",quoted(configured("SHADOW_OIDC_ISSUER","")))
    buildConfigField("String","SHADOW_OIDC_CLIENT_ID",quoted(configured("SHADOW_OIDC_CLIENT_ID","shadow-life-android")))
    buildConfigField("String","SHADOW_OIDC_REDIRECT_URI",quoted(configured("SHADOW_OIDC_REDIRECT_URI","com.shadow.life:/oauth2redirect")))
    buildConfigField("String","SHADOW_OIDC_RESOURCE",quoted(configured("SHADOW_OIDC_RESOURCE","https://api.example.com")))
    manifestPlaceholders["appAuthRedirectScheme"]=configured("SHADOW_OIDC_REDIRECT_SCHEME","com.shadow.life")
  }
  compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }
  buildFeatures { compose=true; buildConfig=true }
}
kotlin { jvmToolchain(17) }
ksp { arg("room.schemaLocation","$projectDir/schemas") }
dependencies {
  implementation(platform("androidx.compose:compose-bom:2025.10.01")); implementation("androidx.activity:activity-compose:1.11.0"); implementation("androidx.compose.material3:material3"); implementation("androidx.compose.material:material-icons-core"); implementation("androidx.compose.foundation:foundation"); implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4"); implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4"); implementation("androidx.navigation:navigation-compose:2.9.5"); implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
  implementation("androidx.room:room-runtime:2.8.3"); implementation("androidx.room:room-ktx:2.8.3"); ksp("androidx.room:room-compiler:2.8.3"); implementation("androidx.work:work-runtime-ktx:2.10.5")
  implementation("androidx.security:security-crypto:1.1.0")
  implementation("androidx.browser:browser:1.8.0")
  implementation("androidx.health.connect:connect-client:1.1.0")
  implementation("net.openid:appauth:0.11.1")
}

plugins { id("com.android.library"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose") }
android { namespace="com.shadow.life.core.designsystem"; compileSdk=36; defaultConfig { minSdk=26 }; compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }; buildFeatures { compose=true } }
kotlin { jvmToolchain(17) }
dependencies { api(project(":core:model")); implementation(platform(libs.compose.bom)); implementation(libs.compose.material3); implementation(libs.compose.icons); implementation(libs.compose.foundation) }

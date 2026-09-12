plugins { id("com.android.library"); id("org.jetbrains.kotlin.android"); id("com.google.devtools.ksp") }
android { namespace="com.shadow.life.core.data"; compileSdk=36; defaultConfig { minSdk=26 }; compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 } }
kotlin { jvmToolchain(17) }
ksp { arg("room.schemaLocation","${rootProject.projectDir}/app/schemas") }
dependencies { api(project(":core:model")); api(libs.room.runtime); api(libs.room.ktx); ksp(libs.room.compiler); implementation(libs.security.crypto); implementation(libs.kotlinx.coroutines.core) }

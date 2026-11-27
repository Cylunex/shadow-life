pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
rootProject.name = "ShadowLife"
include(":embedded", ":core:model", ":core:data", ":core:designsystem", ":devices")
if (gradle.parent == null) include(":app")

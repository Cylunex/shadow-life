# Shadow Life Android

Android is the primary daily client. It is a native Kotlin/Jetpack Compose application with package ID
`com.shadow.life`; it does not host the product Web UI or a Basic Auth prompt.

The root navigation is Today / Records / Plans / Library. The centered Life action opens one composer while
preserving the selected root and its back stack. Manual forms for expense, meal, health, visit and library
capture remain available without an Agent. Reads use typed presentation models backed by the Life API, while
writes first enter the account-bound encrypted command queue and retain their command ID until the authoritative
receipt is known.

## Local configuration

Set deployment-specific values in the user Gradle properties file or on the Gradle command line. Do not commit
real endpoints, subject mappings, credentials or signing paths.

```properties
SHADOW_API_BASE=https://api.example.com
SHADOW_OIDC_ISSUER=https://identity.example.com
SHADOW_OIDC_CLIENT_ID=REPLACE_PUBLIC_CLIENT_ID
SHADOW_OIDC_REDIRECT_URI=com.shadow.life:/oauth2redirect
SHADOW_OIDC_REDIRECT_SCHEME=com.shadow.life
SHADOW_OIDC_RESOURCE=https://api.example.com
SHADOW_FOLIANT_URL=https://foliant.example.com
SHADOW_GARDEN_URL=https://garden.example.com
```

The OIDC client is public and uses Authorization Code + PKCE/S256. The authorization request asks for the exact
Life API resource. Android treats the access token as an opaque bearer and activates an account only after
`GET /api/me` returns the server-owned Life subject mapping. Session generation fences late login and refresh
callbacks after logout or account switching.

## Verification

Use JDK 17 and an Android 36 SDK:

```bash
gradle :app:compileDebugKotlin
```

Health Connect production request construction and round-state regressions remain available through
`pnpm test:android-health`. Compilation is not an APK/package or physical-device acceptance. Signed builds,
installation, Samsung registration, BLE hardware validation and deployment require separate explicit work.

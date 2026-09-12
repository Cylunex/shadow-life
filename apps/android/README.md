# Shadow Life Android

Android is the primary daily client. It is a native Kotlin/Jetpack Compose application with package ID
`com.shadow.life`; it does not host the product Web UI or a Basic Auth prompt.

The root navigation is Today / Records / Plans / Library. The centered Life action opens one composer while
preserving the selected root and its back stack. Manual forms for expense, meal, health, visit and library
capture remain available without an Agent. The same composer can start and continue a native Agent conversation;
only Executor-authenticated operation events are presented as committed results. Records use the paginated
server-side `life.search` capability, and detail pages render explicit domain sections instead of recursive JSON.
If the mobile SSE subscription drops, Android resumes the durable Agent run from its last persisted sequence,
deduplicates Executor receipts, and waits for a terminal or input-required state instead of presenting a partial
transport response as complete.
Timeline, search, and domain lists retain server cursors for incremental loading. Editable meal, money, manual
health, trip, and library details submit version-checked correction commands through the same encrypted queue.
Reads use typed presentation models backed by the Life API, while
writes first enter the account-bound encrypted command queue and retain their command ID until the authoritative
receipt is known.

Android `ACTION_SEND` and `ACTION_SEND_MULTIPLE` enter an account-assignment confirmation before any business
write. Shared text is captured with a stable command identity. Every shared attachment is copied immediately
from its temporary content URI into an app-private encrypted file, receives its own stable upload/command
identity, and is later uploaded and captured by the recoverable sync worker.
The share ingress identity survives activity/process recreation, while an explicit discard remains discarded.
Original display names are retained in the encrypted attachment workflow and become the default library title.

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
```

The OIDC client is public and uses Authorization Code + PKCE/S256. The authorization request asks for the exact
Life API resource. Android treats the access token as an opaque bearer and activates an account only after
`GET /api/me` returns the server-owned Life subject mapping. Session generation fences late login and refresh
callbacks after logout or account switching.
Local logout increments the session generation first, cancels account-specific sync work, clears usable local
tokens, and then makes a best-effort refresh-token revocation when the provider advertises that endpoint.
The versioned authenticated `/api/project-links` directory is supplied by the server's local
`SHADOW_PROJECT_LINKS_FILE` (preferred) or inline `SHADOW_PROJECT_LINKS` configuration. App Links first target an installed Android package and then fall back to an HTTPS Custom Tab;
browser links open directly in a Custom Tab. Life credentials are never appended to either URL.

## Verification

Use JDK 17 and an Android 36 SDK:

```bash
gradle :app:compileDebugKotlin
```

Health Connect production request construction and round-state regressions remain available through
`pnpm test:android-health`. Compilation is not an APK/package or physical-device acceptance. Signed builds,
installation, Samsung registration, BLE hardware validation and deployment require separate explicit work.

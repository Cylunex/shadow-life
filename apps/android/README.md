# Shadow Life Android

Android is the primary daily client. It is a native Kotlin/Jetpack Compose application with package ID
`com.shadow.life`; it does not host the product Web UI or a Basic Auth prompt.

The Android build is split into the five planned Gradle groups: `app`, `core:model`, `core:data`,
`core:designsystem`, and `devices`. Neutral presentation and session models live in model; encrypted Room/session
storage lives in data; reusable Compose tokens/components live in designsystem; deterministic device protocol
and sync-round logic live in devices. App owns navigation, feature UI, dependency assembly and workers.

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
Manual capture keeps the local fact date editable. Expense capture preserves optional category and payment
method. Refund capture selects a visible CNY transaction instead of asking for an internal ID, while foreign
refunds remain explicitly outside that contract. Meal capture accepts multiple food lines and optional decimal
quantity/unit pairs without fabricating nutrition values. Library capture accepts content without forcing a title
and derives a bounded default from its first line.
Reads use typed presentation models backed by the Life API, while
writes first enter the account-bound encrypted command queue and retain their command ID until the authoritative
receipt is known.
Settings exposes account-scoped pending, reconciling, failed, completed and encrypted-attachment counts. Retry
keeps the original command identities; clearing terminal rows requires an inline destructive confirmation and
never removes pending or unknown-outcome work.
The settings flow includes a native reminder inbox. Business notification state, inbox read state and per-device
delivery state are independent; Android requests notification permission only when reminders are enabled and
keeps generic reminder content in the in-app inbox when permission is denied.
Health, money, travel, meal and library entries open native domain workspaces with their own source, planning,
trip, shopping or content summary while retaining server-side search, pagination and typed detail navigation.
The dedicated Library root also retains its server cursor, deduplicates appended pages and keeps search paging
separate from the unfiltered list. Review details retain metric values, original currency labels, coverage and
openable evidence instead of reducing a review to JSON keys. Health cards distinguish missing permission, no
record, partial read failure and real values; unavailable measurements are never rendered as zero.

The device layer also carries the verified Shadow Health integrations. Xiaomi Body Composition Scale 2
(`XMTZC05HM`) and S400 (`MJTZC01YM`) advertisements are parsed locally in an on-demand foreground BLE session;
stable weight, impedance, optional heart rate and profile-derived body composition enter the encrypted Life
command queue before upload. S400 bindkeys and the optional sex/birth-date/height profile are stored with the
Android Keystore and never embedded in source or server configuration. Samsung Health Data SDK 1.1.0 requests all
25 supported read permissions and paginates every directly readable type. Provider-native records preserve common
metadata and every public SDK field, including continuous series, exercise routes/logs and swimming intervals, in
raw archive revisions even when Life does not project the field yet. Steps, activity and goal aggregates are archived
as well. Oversized route payloads are split into ordered, lossless archive chunks below the command-body limit. When
the matching Health Connect permission is already granted, Samsung steps/sleep/exercise and weight
remain archived but are not projected into both paths, avoiding duplicate dashboard facts.
After Samsung permission has been granted, returning to Life starts an immediate unique sync and keeps the hourly
background schedule. Today, Health and Settings show the live read state, record count, queue state and committed
result. Xiaomi Scale 2/S400 scanning reports scan start, first matching advertisement, stable measurement, local
queueing and server commit in the same visible panel; the latest accepted weight remains visible after the service
notification closes.

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
SAMSUNG_HEALTH_DATA_AAR=/absolute/local/path/samsung-health-data-api-1.1.0.aar
AMAP_MAPS_API_KEY=REPLACE_ANDROID_AMAP_KEY
GOOGLE_MAPS_API_KEY=REPLACE_ANDROID_GOOGLE_MAPS_KEY
```

The travel map can switch between native AMap and Google Maps. Use Android-app keys restricted to the
`com.shadow.life` package and its signing certificate; never reuse a browser or Web Service key. Missing keys
do not break the build: the app keeps a coordinate/track preview and labels that provider as unconfigured.
AMap is initialized only after the user accepts its first-use privacy disclosure.

The Samsung AAR is vendor-distributed and intentionally ignored by Git. Builds without the property remain
valid but expose Samsung direct sync as unavailable. Release builds must point at the reviewed local AAR. Samsung
Health Data SDK 1.1.0 requires Android 10, so the unified app uses `minSdk 29`. Xiaomi Scale 2 needs no key; S400
requires its 32-hex-character BLE bindkey in the in-app encrypted scale settings.

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

Health Connect requests the background-read permission only when the installed provider advertises that feature;
otherwise foreground manual sync remains available. Production request construction and round-state regressions remain available through
`pnpm test:android-health`; `:devices:testDebugUnitTest` covers the retained Scale 2/S400 frames and Xiaomi body
composition formula. Compilation is not physical-device acceptance. Signed builds, Samsung registration and BLE
hardware validation remain release gates.

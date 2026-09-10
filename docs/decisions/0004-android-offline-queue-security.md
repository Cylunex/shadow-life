# ADR 0004: Android offline queue security and recovery

Status: accepted for the local implementation boundary.

Pending command bodies, verified receipts and attachment bytes are encrypted before they enter durable app
storage. Each account gets an Android Keystore AES-256-GCM key. Authenticated data binds the ciphertext to
the account, subject, payload kind and stable command or attachment ID, so moving a row or file across
accounts does not make it readable. Room stores only versioned envelopes and queue metadata. App backup and
device-transfer rules exclude the database, attachment directory and session preferences because Keystore
keys are device-bound.

The version 4 to 5 migration does not silently assign unknown data to the active login. Accountless rows stay
in `needs_account` until the user claims them; rows with a known account enter `needs_encryption` and become
eligible for sync only after an atomic local encryption pass. A missing or invalid key moves affected work to
`blocked`. Signing out or a failed refresh does not decrypt or reassign queued data; signing in again with the
same issuer subject reuses the account boundary. Uninstall removes both app storage and its Keystore keys.

Sync keeps the original command ID for every attempt. An `unknown` command first queries the operation by
command ID, and every HTTP response is accepted only when a committed execution receipt binds protocol,
capability, command and execution ID. Receipts are encrypted at rest. Asset uploads are content-addressed on
the server; a lost upload response can therefore repeat without creating another asset version, while the
subsequent library command remains independently idempotent.

Queue states are visible as pending, uploading, unknown, committed, blocked and failed. Transient failure of
one item does not starve later items, and automatic retries stop after eight attempts; an explicit retry resets
the counter but preserves the command ID. Clearing terminal records requires an inline destructive-action
confirmation. A process cancellation restores an in-flight item to `unknown`, which forces receipt recovery
before another command submission. Network and issuer availability failures during token refresh retain the
session and retry with WorkManager backoff; an OAuth token error such as an invalid grant revokes the session
and requires login again without deleting its encrypted queue.

This decision does not claim installed-device coverage. Keystore invalidation, process death, token refresh,
account switching and OS backup behavior still require the configured issuer and physical/emulated device
matrix before release.

package com.shadow.life

import java.security.MessageDigest

internal fun samsungSyncDigest(text: String): String =
  MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }

internal fun samsungPermissionFingerprint(permissions: Set<Pair<String, String>>): String =
  samsungSyncDigest(permissions.sortedWith(compareBy({ it.first }, { it.second }))
    .joinToString("\n") { (type, access) -> "$type:$access" })

internal fun samsungReadDays(now: Long, lastSync: Long, previousFingerprint: String?, fingerprint: String): Long {
  if (lastSync == 0L || previousFingerprint != null && previousFingerprint != fingerprint) return 30
  return ((now - lastSync) / 86_400_000L + 2).coerceIn(2, 30)
}

internal enum class SamsungAggregateMatch { Current, Legacy, Changed }

internal data class SamsungAggregateDigest(val value: String, val match: SamsungAggregateMatch)

internal fun samsungAggregateDigest(
  payload: String,
  parseVersion: String,
  priorDigest: String?,
  legacyPermissionFingerprint: String?
): SamsungAggregateDigest {
  val value = samsungSyncDigest("$parseVersion|$payload")
  val match = when {
    value == priorDigest -> SamsungAggregateMatch.Current
    priorDigest != null && legacyPermissionFingerprint != null &&
      priorDigest == samsungSyncDigest("$legacyPermissionFingerprint|$parseVersion|$payload") -> SamsungAggregateMatch.Legacy
    else -> SamsungAggregateMatch.Changed
  }
  return SamsungAggregateDigest(value, match)
}

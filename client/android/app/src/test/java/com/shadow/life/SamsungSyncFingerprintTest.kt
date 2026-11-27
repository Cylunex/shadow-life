package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class SamsungSyncFingerprintTest {
  @Test fun `permission order and object instances do not affect the fingerprint`() {
    val original = linkedSetOf("steps" to "READ", "sleep" to "READ")
    val reconstructed = linkedSetOf(String(charArrayOf('s','l','e','e','p')) to "READ", "steps" to "READ")
    assertEquals(samsungSyncDigest("sleep:READ\nsteps:READ"), samsungPermissionFingerprint(original))
    assertEquals(samsungPermissionFingerprint(original), samsungPermissionFingerprint(reconstructed))
    assertNotEquals(samsungPermissionFingerprint(original), samsungPermissionFingerprint(setOf("steps" to "READ")))
    assertNotEquals(samsungPermissionFingerprint(original), samsungPermissionFingerprint(setOf("steps" to "WRITE", "sleep" to "READ")))
  }

  @Test fun `migration keeps the existing incremental window and real permission changes backfill`() {
    val now = 86_400_000L * 60
    assertEquals(2L, samsungReadDays(now, now - 25, null, "stable"))
    assertEquals(2L, samsungReadDays(now, now - 25, "stable", "stable"))
    assertEquals(30L, samsungReadDays(now, now - 25, "old stable", "stable"))
    assertEquals(30L, samsungReadDays(now, 0, null, "stable"))
    assertEquals(8L, samsungReadDays(now, now - 86_400_000L * 6, "stable", "stable"))
  }

  @Test fun `old cache entries migrate in place while changed and new aggregates can be queued`() {
    val payload = """{"steps":42}"""
    val legacy = "legacy-fingerprint"
    val oldDigest = samsungSyncDigest("$legacy|test-version|$payload")
    val migrated = samsungAggregateDigest(payload, "test-version", oldDigest, legacy)
    assertEquals(SamsungAggregateMatch.Legacy, migrated.match)
    assertNotEquals(oldDigest, migrated.value)

    val unchanged = samsungAggregateDigest(payload, "test-version", migrated.value, legacy)
    assertEquals(SamsungAggregateMatch.Current, unchanged.match)
    assertEquals(migrated.value, unchanged.value)

    val modified = samsungAggregateDigest("""{"steps":43}""", "test-version", oldDigest, legacy)
    assertEquals(SamsungAggregateMatch.Changed, modified.match)
    assertNotEquals(migrated.value, modified.value)
    assertEquals(SamsungAggregateMatch.Changed, samsungAggregateDigest(payload, "test-version", null, legacy).match)
    assertEquals(SamsungAggregateMatch.Changed, samsungAggregateDigest(payload, "updated-parser", migrated.value, legacy).match)
  }
}

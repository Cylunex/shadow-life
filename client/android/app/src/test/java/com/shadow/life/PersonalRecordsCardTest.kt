package com.shadow.life

import java.time.LocalDate
import java.time.ZoneId
import java.time.Duration
import android.app.Application
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class PersonalRecordsCardTest {
    @Test fun typedQueryFiltersAndPaginationAreSerialized() {
        val query = JSONObject().put("limit", 20).put("selected", false).put("zone", "Asia/Shanghai").put("unset", JSONObject.NULL)
        assertEquals(mapOf("limit" to "20", "selected" to "false", "zone" to "Asia/Shanghai"), query.personalQueryParams())
    }

    @Test fun missingCoverageRespectsDayLengthAndPagination() {
        val date = LocalDate.parse("2026-03-08")
        val zone = ZoneId.of("America/Los_Angeles")
        assertEquals(emptyList<Pair<Any, Any>>(), offlineRecordGaps(date, zone, emptyList(), false))
        val (from, to) = offlineRecordGaps(date, zone, emptyList(), true).single()
        assertEquals(23L, Duration.between(from, to).toHours())
    }
}

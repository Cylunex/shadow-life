package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MoneyStatementTest {
  @Test fun batchSelectionExcludesTransactionsThatNeedReview(){
    val row=MoneyImportCandidateSummary("candidate",1,1,"pending","{}","expense","3.50",
      "2026-11-20","Asia/Shanghai","合成商家","",null,emptyList())
    assertTrue(row.canConfirmWithoutEdit())
    assertEquals(false,row.copy(duplicateOfCandidate="prior").canConfirmWithoutEdit())
    assertEquals(false,row.copy(entryType="refund").canConfirmWithoutEdit())
    assertEquals(false,row.copy(issues=listOf("missing_date")).canConfirmWithoutEdit())
  }
}

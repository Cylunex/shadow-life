package com.shadow.life

import org.junit.Assert.*
import org.junit.Test

class MoneyCorrectionTest {
  private val seed=EditSeed.Money("record_example",3,"12.00","CNY","2026-09-10","Asia/Shanghai","日用","示例商店","原备注")
  @Test fun noteOnlyEditPreservesUneditedAndHiddenFields(){
    val draft=CorrectionDraft("12.00","日用","补充备注","2026-09-10","示例商店","核对")
    assertTrue(moneyCorrectionClearFields(seed,draft).isEmpty())
  }
  @Test fun deletingExistingValuesIsExplicit(){
    val draft=CorrectionDraft("12.00"," ","","2026-09-10","","核对")
    assertEquals(listOf("category","counterparty","note"),moneyCorrectionClearFields(seed,draft))
    assertTrue(moneyCorrectionClearFields(seed.copy(category=null,counterparty=null,note=null),draft).isEmpty())
  }
}

package com.shadow.life

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w393dp-h852dp-mdpi", application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MoneyReconciliationTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun refreshingTheLedgerKeepsTheSelectedImportBatchOpen() {
    val period = "2026-11"
    val asOf = "2026-11-20T03:00:00Z"
    val ledger = RecordPage(emptyList(), null, asOf)
    val overview = WorkspaceOverview.Money(period, emptyList(), 0, 0, 0, asOf = asOf)
    val batch = MoneyImportBatchSummary("batch_test", "测试账单.json", 1, 0, 0, 0, 0)
    val month = MoneyImportMonthSummary(period, 0, 0, 0, 0, listOf(batch))
    var records by mutableStateOf(LoadState.Ready(ledger))
    var review by mutableStateOf<LoadState<MoneyImportReviewSummary>?>(null)

    compose.setContent {
      LifeTheme(Appearance.Light) {
        MoneyWorkspaceScreen(
          overviewState = LoadState.Ready(overview),
          recordsState = records,
          onSearch = {},
          onRetry = {},
          onLoadMore = {},
          onBack = {},
          onDetail = { _, _, _ -> },
          onCapture = {},
          initialTab = "reconcile",
          planningState = SubmitState.Editing,
          onSaveBudget = {},
          onSaveRecurring = {},
          onSaveIntent = {},
          onSaveCycle = {},
          onConsumableUse = {},
          onOccurrence = { _, _ -> },
          onResetPlanning = {},
          cardsState = LoadState.Loading,
          selectedCard = null,
          cardSubmit = SubmitState.Editing,
          onLoadCards = {},
          onMoreCards = {},
          onOpenCard = {},
          onCloseCard = {},
          onOlderUses = {},
          onSaveCard = {},
          onCardUse = {},
          onResetCard = {},
          importMonth = LoadState.Ready(month),
          importReview = review,
          importSubmit = SubmitState.Editing,
          onLoadImportMonth = {},
          onOpenImportBatch = {
            review = LoadState.Ready(MoneyImportReviewSummary(it, emptyList(), emptyMap()))
          },
          onResolveImport = { _, _, _, _, _, _, _ -> },
          planningPeriod = period,
          onPlanningPeriod = {},
          onOrderStats = {},
          onPriceBook = {},
          onReturns = {},
          refundCandidates = LoadState.Loading,
          onSearchRefunds = {},
          importPendingId = null
        )
      }
    }

    compose.onNodeWithText(batch.name).performClick()
    compose.onNodeWithText("只看待处理").assertExists()

    compose.runOnIdle { records = records.copy(refreshing = true) }
    compose.onNodeWithText("只看待处理").assertExists()

    compose.runOnIdle { records = records.copy(refreshing = false, updateAvailable = true) }
    compose.onNodeWithText("‹ 返回批次").assertExists()
    compose.onNodeWithText("这批账单没有待处理的条目").assertExists()
  }

  @Test fun collapsedSummaryShowsTheValuesThatWillBeConfirmed() {
    val period = "2026-11"
    val batch = MoneyImportBatchSummary("batch_test", "测试账单.json", 1, 1, 0, 0, 0)
    val month = MoneyImportMonthSummary(period, 1, 0, 0, 0, listOf(batch))
    val candidate = MoneyImportCandidateSummary(
      "candidate_test",1,1,"pending","{}","expense","56.80","2026-11-20",
      "Asia/Shanghai","测试商家","餐饮",null,emptyList()
    )
    var submitted = emptyList<String>()
    compose.setContent {
      LifeTheme(Appearance.Light) {
        NativeMoneyImportSection(
          period, LoadState.Ready(month),
          LoadState.Ready(MoneyImportReviewSummary(batch.id, listOf(candidate), emptyMap())),
          SubmitState.Editing, {}, {}, { _, decision, type, amount, date, category, _ ->
            submitted = listOf(decision, type, amount, date, category)
          }, LoadState.Loading, {}, null, {}
        )
      }
    }
    compose.onNodeWithText(batch.name).performClick()
    compose.onNodeWithText("修改").performClick()
    compose.onNodeWithText("精确金额（CNY）").performTextReplacement("65.80")
    compose.onNodeWithText("分类（可选）").performTextReplacement("")
    compose.onNodeWithText("收起修改").performClick()
    compose.onNodeWithText("65.80 CNY").assertExists()
    compose.onNodeWithText("原始建议 · 金额 56.80 · 分类 餐饮").assertExists()
    compose.onNodeWithText("确认入账").performClick()
    compose.runOnIdle {
      assertEquals(listOf("confirm","expense","65.80","2026-11-20",""),submitted)
    }
  }
}

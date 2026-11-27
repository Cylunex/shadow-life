package com.shadow.life

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class TimelineGroupingTest {
  @get:Rule val compose=createAndroidComposeRule<ComponentActivity>()

  @Test fun opensOriginalFromCollapsedUpload(){
    val date=LocalDate.now()
    fun row(id:String,batch:String?)=TimelineItem(LifeDomain.Health,"observation",id,"${date}T08:00:00Z",id,batchId=batch)
    val records=listOf(row("第一项","batch_one"),row("单独记录",null),row("第二项","batch_one"))
    var opened:String?=null
    compose.setContent {
      LifeTheme(Appearance.Light){
        RecordsVisualScreen(LoadState.Ready(TimelinePage(records,null,date.toString())),null,
          {},{},{},{},{},{_,id,_->opened=id},{},{},{},date,LoadState.Loading,LoadState.Ready(emptyList()),{},{},{})
      }
    }
    val list=compose.onNode(hasScrollToIndexAction())
    list.performScrollToNode(hasText("同一批次 · 已加载 2 条"))
    compose.onNodeWithText("第二项").assertDoesNotExist()
    compose.onNodeWithText("展开").performClick()
    compose.onNodeWithText("第二项").performScrollTo().performClick()
    compose.runOnIdle{assertEquals("第二项",opened)}
  }
}

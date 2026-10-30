package com.shadow.life

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.LocalDate

/** Debug-only synthetic fixture. It never activates an account or submits business commands. */
class ExperienceQaActivity:ComponentActivity(){
  override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState)
    val initial=intent.getStringExtra("screen")?:"home"
    setContent{
      var screen by remember{mutableStateOf(initial)}
      var dark by remember{mutableStateOf(intent.getBooleanExtra("dark",false))}
      var composer by remember{mutableStateOf(initial=="composer")}
      val store=remember{UiDraftStore(this,"experience-qa")}
      var submit:SubmitState by remember{mutableStateOf(SubmitState.Editing)}
      val today=LocalDate.now().toString()
      val snapshot=TodaySnapshot(today,mealCount=2,moneyTotals=listOf(MoneyTotal("CNY","86.50","0")),health=TodayHealthSummary(HealthSummaryState.Ready,"65.2","kg",today,6280,452),asOf=today)
      val planning=PlanningWorkspace(emptyList(),listOf(PlanSummary("project-qa","整理周末行程","留出阅读时间","active",null,1,2)),emptyList(),emptyList(),false,today)
      val samples=(0..6).map{index->HealthTrendPoint("weight-$index",LocalDate.now().minusDays((6-index).toLong()).toString(),65.0+index*.1,(65.0+index*.1).toString(),"kg","manual",1)}
      val health=WorkspaceOverview.Health(1,0,1,snapshot.health,metrics=listOf(HealthMetricTrend("weight","体重",samples,7,false)),asOf=today)
      LifeTheme(if(dark)Appearance.Dark else Appearance.Light){
        CompositionLocalProvider(LocalUiDraftScope provides UiDraftScope(store,"capture")){
          Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()){
            LifeTabs(screen,{screen=it;composer=it=="composer"},listOf("home" to "生活","records" to "记录","plans" to "计划","library" to "资料","health" to "健康","detail" to "详情","composer" to "录入","training" to "训练"))
            TextButton(onClick={dark=!dark}){Text("切换深浅色")}
            Box(Modifier.weight(1f)){
              when(screen){
                "home"->TodayVisualScreen("experience-qa",LoadState.Ready(snapshot),LoadState.Ready(health),DeviceSyncStatus(scaleLastWeight="65.2",scaleLastModel="小米体脂秤"),LoadState.Ready(QueueSummary(0,0,0,0,0)),false,{}, {_,_->},{},{},{},{_,_,_->},{},{},{},{},{},{},{},{},onSettings={},trainingState=LoadState.Empty("暂无训练"))
                "records"->RecordsVisualScreen(LoadState.Ready(TimelinePage(listOf(TimelineItem(LifeDomain.Money,"expense","money-qa","${today}T12:00:00+08:00","午餐","28.00","CNY")),null,today)),null,{},{},{},{},{},{_,_,_->},{composer=true},{},{},LocalDate.now(),LoadState.Ready(DayPage(today,emptyList(),0,null,today,listOf("money"))),LoadState.Ready(emptyList()),{},{},{})
                "plans"->PlansVisualScreen(LoadState.Ready(planning),null,{},{},{},{},{},{_,_->},{},{},{},{},goals={Text("明确的目标与偏好")})
                "library"->LibraryVisualScreen(LoadState.Ready(LibraryPage(listOf(LibrarySummary("note-qa","周末阅读笔记","note","active",1),LibrarySummary("ticket-qa","周六的车票","ticket","active",1)),null,today)),{},{},{_,_,_->},{},{},{})
                "health"->HealthWorkspaceScreen("experience-qa",LoadState.Ready(health),LoadState.Empty("暂无记录"),DeviceSyncStatus(),LoadState.Ready(QueueSummary(0,0,0,0,0)),false,{},{},{},{_,_,_->},{},{},{},{},{},{},initialTab="body",releaseState=LoadState.Empty("暂无记录"),onReleaseLoad={_,_->})
                "detail"->DetailScreen("阅读笔记",LoadState.Ready(RecordDetail("周末阅读笔记","active",1,listOf(DetailSection("当前内容",listOf(DetailFact("正文","留一段完整的时间读书。\n\n这里是合成的阅读材料，用于检查中文排版、长正文阅读与详情返回。")))),EditSeed.Library("note-qa",1,"周末阅读笔记","留一段完整的时间读书。",null,emptyList()),presentation=DetailPresentation.Library)),submit,{},{},{},{},{_,_->submit=SubmitState.Rejected("合成页面：保留输入")},{submit=SubmitState.Editing},{},{},{},accountId="experience-qa")
                "training"->Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)){TrainingMenuWorkspace("experience-qa",LoadState.Empty("暂无计划"),SubmitState.Editing,{},{_,_,_->},{})}
              }
            }
          }
          LifeComposerHost(composer,CaptureSeed(CaptureKind.Expense,date=today),submit,null,null,LoadState.Ready(emptyList()),null,LoadState.Empty("无交易"),{},{},{},{},{composer=false},{submit=SubmitState.Rejected("合成页面：保存失败，输入保持")},{},{submit=SubmitState.Editing})
        }
      }
    }
  }
}

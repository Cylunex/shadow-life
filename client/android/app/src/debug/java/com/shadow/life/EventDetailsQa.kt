package com.shadow.life

import androidx.compose.runtime.Composable

/** Synthetic local visual acceptance, excluded from release. */
@Composable internal fun EventDetailsQa(screen:String){
 val kind=when(screen){"qa-body"->DetailPresentation.HealthMetric;"qa-sleep"->DetailPresentation.Sleep;"qa-meal"->DetailPresentation.Meal;"qa-money"->DetailPresentation.Money;else->DetailPresentation.Workout}
 val title=when(kind){DetailPresentation.HealthMetric->"身体测量";DetailPresentation.Sleep->"昨晚睡眠";DetailPresentation.Meal->"燕麦与牛奶";DetailPresentation.Money->"街角便利店";else->"全身力量训练"}
 val sections=when(kind){
  DetailPresentation.Meal->listOf(DetailSection("食物与营养",groups=listOf(DetailGroup("qa-oats","原味燕麦",listOf(DetailFact("份量","40 g"),DetailFact("热量","150 kcal"))),DetailGroup("qa-milk","纯牛奶",listOf(DetailFact("份量","250 ml"),DetailFact("热量","170 kcal"))),DetailGroup("qa-berry","蓝莓",listOf(DetailFact("份量","1 小把"),DetailFact("热量","未记录"))))))
  DetailPresentation.Money->listOf(DetailSection("购买明细",groups=listOf(DetailGroup("qa-milk","纯牛奶",listOf(DetailFact("数量","1 盒"),DetailFact("金额","CNY 6.50"))),DetailGroup("qa-bread","全麦面包",listOf(DetailFact("数量","1 袋"),DetailFact("金额","CNY 12.00"))))))
  else->listOf(DetailSection("概要",listOf(DetailFact("日期","2026-10-31"),DetailFact("开始时间","08:12"),DetailFact("记录方式","合成样例"))))
 }
 val metrics=if(kind==DetailPresentation.HealthMetric)listOf(DetailMetric("qa-w","weight","体重","68.4","kg",false),DetailMetric("qa-f","body_fat","体脂率","21.8","%",true),DetailMetric("qa-m","muscle_mass","肌肉量","50.2","kg",true),DetailMetric("qa-b","bmi","BMI","22.6","kg/m²",true)) else emptyList()
 val detail=RecordDetail(title,null,1,sections,presentation=kind,heroValue=when(kind){DetailPresentation.HealthMetric->"68.4 kg";DetailPresentation.Sleep->"7 小时 12 分";DetailPresentation.Money->"CNY 18.50";DetailPresentation.Workout->"32 分钟";else->null},heroSupporting="2026-10-31 · 合成数据",metrics=metrics,sleepStages=if(kind==DetailPresentation.Sleep)listOf(SleepStage("深睡",82),SleepStage("浅睡",258),SleepStage("REM",92),SleepStage("清醒",26)) else emptyList())
 DetailScreen(title,LoadState.Ready(detail),SubmitState.Editing,{},{},{},{},{_,_->},{},{},{},{})
}

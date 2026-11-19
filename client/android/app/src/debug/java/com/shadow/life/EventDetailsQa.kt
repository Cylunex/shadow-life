package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Synthetic local visual acceptance, excluded from release. */
@Composable internal fun EventDetailsQa(screen:String){
 if(screen=="qa-dining"){DiningDirectoryQa();return}
 val kind=when(screen){"qa-body"->DetailPresentation.HealthMetric;"qa-sleep"->DetailPresentation.Sleep;"qa-meal","qa-lunch"->DetailPresentation.Meal;"qa-money"->DetailPresentation.Money;else->DetailPresentation.Workout}
 val title=when(kind){DetailPresentation.HealthMetric->"身体测量";DetailPresentation.Sleep->"昨晚睡眠";DetailPresentation.Meal->if(screen=="qa-lunch")"午餐" else "早餐";DetailPresentation.Money->"街角便利店";else->"全身力量训练"}
 val sections=when(kind){
  DetailPresentation.Meal->emptyList()
  DetailPresentation.Money->listOf(DetailSection("购买明细",groups=listOf(DetailGroup("qa-milk","纯牛奶",listOf(DetailFact("数量","1 盒"),DetailFact("金额","CNY 6.50"))),DetailGroup("qa-bread","全麦面包",listOf(DetailFact("数量","1 袋"),DetailFact("金额","CNY 12.00"))))))
  else->listOf(DetailSection("概要",listOf(DetailFact("日期","2026-10-31"),DetailFact("开始时间","08:12"),DetailFact("记录方式","合成样例"))))
 }
 val metrics=if(kind==DetailPresentation.HealthMetric)listOf(DetailMetric("qa-w","weight","体重","68.4","kg",false),DetailMetric("qa-f","body_fat","体脂率","21.8","%",true),DetailMetric("qa-m","muscle_mass","肌肉量","50.2","kg",true),DetailMetric("qa-b","bmi","BMI","22.6","kg/m²",true)) else emptyList()
 val mealId="qa-record"
 val foods=when(screen){
  "qa-meal"->listOf(
   qaFood(mealId,0,"原味燕麦","40","g","150","5",null),
   qaFood(mealId,1,"纯牛奶","250","ml","170","8",null),
   qaFood(mealId,2,"蓝莓","1","小把",null,null,null))
  "qa-lunch"->listOf(
   qaFood(mealId,0,"杂粮米饭","120","g","155","4","0.5","本人吃了半碗，克重参考档口称量"),
   qaFood(mealId,1,"香菇滑鸡","1","平勺","195","18",null,"常用平勺和档口价目换算"),
   qaFood(mealId,2,"蒜蓉小白菜","1","平勺",null,null,null),
   qaFood(mealId,3,"紫菜汤","1","碗",null,null,"0"))
  else->emptyList()
 }
 val detail=RecordDetail(title,null,1,sections,presentation=kind,heroValue=when(kind){DetailPresentation.HealthMetric->"68.4 kg";DetailPresentation.Sleep->"7 小时 12 分";DetailPresentation.Money->"CNY 18.50";DetailPresentation.Workout->"32 分钟";else->null},heroSupporting="2026-10-31 · 合成数据",metrics=metrics,sleepStages=if(kind==DetailPresentation.Sleep)listOf(SleepStage("深睡",82),SleepStage("浅睡",258),SleepStage("REM",92),SleepStage("清醒",26)) else emptyList(),meal=title.takeIf{kind==DetailPresentation.Meal}?.let{MealDetailInfo(mealId,it,"2026-11-19",if(screen=="qa-lunch")"12:25" else "08:12",null)},mealIntakes=foods)
 DetailScreen(title,LoadState.Ready(detail),SubmitState.Editing,{},{},{},{},{_,_->},{},{},{},{})
}


private fun qaFood(meal:String,position:Long,name:String,quantity:String,unit:String,kcal:String?,protein:String?,fraction:String?,note:String?=null)=
 LifeRecordResultDtoMealItemsEntry(
  id="qa-food-$position",mealId=meal,position=position,name=name,foodRefId=null,freeText=name,quantity=quantity,unit=unit,
  amountG=quantity.takeIf{unit=="g"},energyKcal=kcal,proteinG=protein,fatG=null,carbG=null,fiberG=null,sodiumMg=null,
  consumedFraction=fraction,provenance=null,groupingOrigin=null,estimate=note!=null,evidenceNote=note,revision=1
 )

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun DiningDirectoryQa(){
 val sample=MerchantMenuResultDtoDirectory("2026-10-21","2026-11-19","东区食堂",
  listOf(MerchantMenuResultDtoDirectoryMerchantsEntry("东区食堂",32,12),MerchantMenuResultDtoDirectoryMerchantsEntry("街角面馆",3,2)),
  listOf(MerchantMenuResultDtoDirectoryDishesEntry("杂粮米饭","东区食堂","qa-food-1",8,"qa-meal-1"),
    MerchantMenuResultDtoDirectoryDishesEntry("原味燕麦",null,null,4,"qa-meal-2")),
  listOf(MerchantMenuResultDtoDirectoryTakeoutEntry("qa-order-1","qa-order-1",null,"街角面馆","2026-11-17",listOf("番茄牛肉面","凉拌海带丝"),false)))
 var tab by remember{mutableIntStateOf(0)}
 Scaffold(topBar={TopAppBar(title={Text("菜品与门店")},navigationIcon={LifeBackButton{}})}){padding->
  Column(Modifier.fillMaxSize().padding(padding)){
   PrimaryTabRow(tab){listOf("门店","常吃","外卖").forEachIndexed{index,label->Tab(tab==index,{tab=index},text={Text(label)})}}
   LazyColumn(contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
    catalogDirectoryItems(tab,sample,"",{}, {})
   }
  }
 }
}

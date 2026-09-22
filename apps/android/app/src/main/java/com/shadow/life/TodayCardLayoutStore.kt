package com.shadow.life

import android.content.Context

enum class TodayCardKind(val key:String,val title:String,val description:String){
  Focus("focus","生活概览","正在进行的旅程与生活记录入口"),
  Scale("scale","小米体脂秤","直接开启接收并查看本次结果"),
  Health("health","健康总览","当天活动与近 7 天步数趋势"),
  Body("body","身体分析","体重与身体成分趋势"),
  Activity("activity","运动","步数、活跃时间与运动记录"),
  Sleep("sleep","睡眠","睡眠时长、分期和近七天趋势"),
  Meals("meals","饮食","餐次、餐照与营养记录"),
  Money("money","消费","当天净支出，按原币种分别显示"),
  Travel("travel","旅行","当前旅程、行程与地点"),
  TravelMap("travel_map","旅行地图","真实地点与轨迹地图"),
  Items("items","物品","使用、保修、维护与补给"),
  Plans("plans","计划","项目、行动与生活回顾"),
  Agenda("agenda","待处理账单","已到期的订阅与周期费用"),
  QuickCapture("quick_capture","快速记录","消费、饮食、健康、运动和到访"),
  Library("library","资料","照片、文件、链接、笔记与票券"),
  Records("records","全部记录","按领域和时间查看生活时间线"),
  DeviceSync("device_sync","其他数据源","Samsung Health 与小米体脂秤")
}

// Saved layouts keep their stable keys and order; only new/reset layouts use this sequence.
val defaultTodayCards=listOf(
  TodayCardKind.Focus,TodayCardKind.QuickCapture,TodayCardKind.Health,
  TodayCardKind.Meals,TodayCardKind.Money,TodayCardKind.Travel,
  TodayCardKind.Plans,TodayCardKind.Items,TodayCardKind.Library,TodayCardKind.Scale
)

internal fun decodeTodayCards(raw:String?):List<TodayCardKind>{
  if(raw==null)return defaultTodayCards
  val byKey=TodayCardKind.entries.associateBy(TodayCardKind::key)
  return raw.split(',').mapNotNull{byKey[it]}.distinct()
}

internal fun moveTodayCard(cards:List<TodayCardKind>,from:Int,to:Int):List<TodayCardKind>{
  if(from !in cards.indices||to !in cards.indices||from==to)return cards
  return cards.toMutableList().apply{add(to,removeAt(from))}
}

class TodayCardLayoutStore(context:Context,private val accountId:String){
  private val preferences=context.applicationContext.getSharedPreferences("life_today_cards",Context.MODE_PRIVATE)
  private val storageKey="cards:$accountId"
  fun current():List<TodayCardKind> = decodeTodayCards(preferences.getString(storageKey,null))
  fun save(cards:List<TodayCardKind>){preferences.edit().putString(storageKey,cards.distinct().joinToString(","){it.key}).apply()}
  fun reset():List<TodayCardKind> = defaultTodayCards.also(::save)
}

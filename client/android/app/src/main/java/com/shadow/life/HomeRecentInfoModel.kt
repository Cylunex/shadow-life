package com.shadow.life

import android.os.SystemClock
import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import java.time.Instant

// Owned by the home navigation entry, so scrolling a LazyColumn card off screen
// does not discard its results or start the same requests again.
internal class HomeRecentInfoModel(private val app:ShadowApp,private val accountId:String):ViewModel(){
  private val repository=NativeLifeRepository(app,app)
  var resolved by mutableStateOf<Map<String,HomeRecentInfo?>>(emptyMap());private set
  var remote by mutableStateOf<List<HomeRecentInfo>>(emptyList());private set
  var loading by mutableStateOf(false);private set
  var error by mutableStateOf<String?>(null);private set
  private var lastAttempt:Long?=null
  private var work:Job?=null
  private var latest:List<RecentCaptureInfo> = emptyList()

  fun refresh(local:List<RecentCaptureInfo>,manual:Boolean=false){
    latest=local
    if(loading)return
    if(work?.isActive==true){if(!manual)return;work?.cancel()}
    work=viewModelScope.launch{
      delay(recentInfoRefreshDelay(lastAttempt,SystemClock.elapsedRealtime(),manual))
      if(app.sessions.active()?.accountId!=accountId)return@launch
      val snapshot=latest
      lastAttempt=SystemClock.elapsedRealtime();loading=true;error=null
      try{
        coroutineScope{
          launch{
            val entries=snapshot.filter{it.state=="committed"}.map{item->async{
              val row=try{
                when{
                  item.moneyRecordId!=null->{
                    val detail=repository.detail(LifeDomain.Money,item.moneyRecordId)
                    HomeRecentInfo(item.key,item.at,listOfNotNull(detail.title,detail.heroValue).joinToString(" · "),if(detail.state=="confirmed")"已入账 · 查看消费" else "账目状态已变化",LifeDomain.Money,item.moneyRecordId)
                  }
                  item.sourceId!=null->{
                    val source=repository.activitySource(item.sourceId)
                    HomeRecentInfo(item.key,item.at,source.title,"已收录材料 · 入账结果见采集结果",LifeDomain.Library,"capture:${source.id}")
                  }
                  else->HomeRecentInfo(item.key,item.at,"采集结果待核对","已同步 · 查看采集结果")
                }
              }catch(e:CancellationException){throw e}catch(_:Exception){HomeRecentInfo(item.key,item.at,"采集结果暂不可读取","已同步 · 可刷新重试")}
              item.key to row
            }}.awaitAll().toMap()
            if(app.sessions.active()?.accountId==accountId)resolved=entries
          }
          launch{
            try{
              val page=repository.timeline()
              if(app.sessions.active()?.accountId==accountId)remote=page.items.filter{it.kind!="activity_capture"}.map{item->HomeRecentInfo("record:${item.domain}:${item.recordId?:item.id}",runCatching{Instant.parse(item.happenedAt).toEpochMilli()}.getOrDefault(0),item.title,"${item.domain.label()} · 已记录",item.domain,item.recordId?:item.id)}
            }catch(e:CancellationException){throw e}catch(_:Exception){if(app.sessions.active()?.accountId==accountId)error="最近记录未更新，可稍后刷新。"}
          }
        }
      }finally{
        loading=false
        work=null
      }
      if(latest!=snapshot)refresh(latest)
    }
  }
}

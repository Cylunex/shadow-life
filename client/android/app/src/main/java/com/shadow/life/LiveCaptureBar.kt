package com.shadow.life

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@Composable internal fun LiveCaptureBar(accountId:String,onOpen:()->Unit){
  val context=LocalContext.current
  val recording=LifeRecordingState.accountId==accountId&&LifeRecordingState.status in setOf("recording","paused","finishing")
  val location=LifeLocationState.accountId==accountId&&LifeLocationState.running
  if(!recording&&!location)return
  Surface(color=MaterialTheme.colorScheme.primaryContainer){
    Column(Modifier.fillMaxWidth().padding(horizontal=12.dp,vertical=4.dp)){
      if(recording)Row(verticalAlignment=Alignment.CenterVertically){
        Text(if(LifeRecordingState.status=="paused")"录音已暂停 · 返回继续" else "正在录音 · 查看采集",Modifier.weight(1f).clickable(onClick=onOpen).padding(12.dp),style=MaterialTheme.typography.labelLarge)
        IconButton(onClick={if(LifeRecordingState.accountId==accountId)context.startService(Intent(context,LifeRecordingService::class.java).setAction("stop"))},enabled=LifeRecordingState.status!="finishing"){Icon(Icons.Default.Close,"结束录音")}
      }
      if(location)Row(verticalAlignment=Alignment.CenterVertically){
        Text("地点记录中 · 查看采集",Modifier.weight(1f).clickable(onClick=onOpen).padding(12.dp),style=MaterialTheme.typography.labelLarge)
        IconButton(onClick={if(LifeLocationState.accountId==accountId)context.startService(Intent(context,LifeLocationService::class.java).setAction("stop"))}){Icon(Icons.Default.Close,"结束地点记录")}
      }
    }
  }
}

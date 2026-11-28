package com.shadow.life
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable internal fun OfflineReadBanner(accountId:String,onRetry:()->Unit){
  val cached by OfflineReads.cached.collectAsState()
  val times=cached[accountId].orEmpty().values
  if(times.isNotEmpty())Surface(color=MaterialTheme.colorScheme.secondaryContainer){
    Row(Modifier.fillMaxWidth().padding(horizontal=16.dp),horizontalArrangement=Arrangement.SpaceBetween){
      Text("部分内容为离线副本 · "+java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(java.util.Date(times.min())),Modifier.weight(1f).padding(vertical=12.dp),style=MaterialTheme.typography.bodySmall)
      TextButton(onClick=onRetry){Text("重试")}
    }
  }
}

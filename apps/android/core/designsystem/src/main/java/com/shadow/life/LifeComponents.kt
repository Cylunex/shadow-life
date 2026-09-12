package com.shadow.life

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable fun LifeSection(title:String,modifier:Modifier=Modifier,action:(@Composable ()->Unit)?=null,content:@Composable ColumnScope.()->Unit){
  Column(modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)){
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(title,style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f));action?.invoke()}
    content()
  }
}

@Composable fun LifeCard(modifier:Modifier=Modifier,onClick:(()->Unit)?=null,content:@Composable ColumnScope.()->Unit){
  val shape=RoundedCornerShape(20.dp)
  Surface(modifier=modifier.fillMaxWidth().then(if(onClick!=null)Modifier.clickable(role=Role.Button,onClick=onClick) else Modifier),shape=shape,color=MaterialTheme.colorScheme.surface,tonalElevation=0.dp,shadowElevation=0.dp,border=BorderStroke(1.dp,MaterialTheme.colorScheme.outline.copy(alpha=.72f))){Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(8.dp),content=content)}
}

@Composable fun RecordRow(item:RecordSummary,onClick:()->Unit){
  Row(Modifier.fillMaxWidth().clickable(role=Role.Button,onClick=onClick).padding(vertical=12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
    Surface(Modifier.size(40.dp),shape=RoundedCornerShape(12.dp),color=domainColor(item.domain).copy(alpha=.16f)){Box(contentAlignment=Alignment.Center){Text(domainMark(item.domain),color=domainColor(item.domain),fontWeight=FontWeight.SemiBold)}}
    Column(Modifier.weight(1f)){Text(item.title,maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.titleMedium);item.supporting?.let{Text(it,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
    item.trailing?.let{Text(it,style=MaterialTheme.typography.titleMedium)}
  }
}

@Composable fun <T> StateContent(state:LoadState<T>,onRetry:()->Unit,empty:String="这里还没有内容",content:@Composable (T)->Unit){when(state){
  LoadState.Loading->Box(Modifier.fillMaxWidth().padding(40.dp),contentAlignment=Alignment.Center){CircularProgressIndicator()}
  is LoadState.Empty->EmptyState(state.reason.ifBlank{empty})
  is LoadState.Failed->SectionError(state.message,onRetry)
  is LoadState.Ready->content(state.value)
}}

@Composable fun EmptyState(message:String,actionLabel:String?=null,onAction:(()->Unit)?=null){Column(Modifier.fillMaxWidth().padding(vertical=28.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(10.dp)){Text(message,color=MaterialTheme.colorScheme.onSurfaceVariant);if(actionLabel!=null&&onAction!=null)TextButton(onClick=onAction){Text(actionLabel)}}}
@Composable fun SectionError(message:String,onRetry:()->Unit){Surface(Modifier.fillMaxWidth(),shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.errorContainer){Row(Modifier.padding(16.dp),verticalAlignment=Alignment.CenterVertically){Text(message,Modifier.weight(1f),color=MaterialTheme.colorScheme.onErrorContainer);IconButton(onClick=onRetry){Icon(Icons.Default.Refresh,"重试")}}}}

@Composable internal fun domainColor(domain:LifeDomain)=when(domain){LifeDomain.Health->MaterialTheme.colorScheme.primary;LifeDomain.Meals->MaterialTheme.colorScheme.tertiary;LifeDomain.Money,LifeDomain.Travel,LifeDomain.Library->MaterialTheme.colorScheme.secondary}
private fun domainMark(domain:LifeDomain)=when(domain){LifeDomain.Health->"健";LifeDomain.Meals->"食";LifeDomain.Money->"账";LifeDomain.Travel->"行";LifeDomain.Library->"文"}

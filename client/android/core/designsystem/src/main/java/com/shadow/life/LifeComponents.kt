package com.shadow.life

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.Instant
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.luminance
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
  val shape=RoundedCornerShape(18.dp)
  Surface(modifier=modifier.fillMaxWidth().then(if(onClick!=null)Modifier.clickable(role=Role.Button,onClick=onClick) else Modifier),shape=shape,color=MaterialTheme.colorScheme.surface,tonalElevation=0.dp,shadowElevation=0.dp,border=BorderStroke(1.dp,MaterialTheme.colorScheme.outline.copy(alpha=.3f))){Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(8.dp),content=content)}
}

@Composable fun RecordRow(item:RecordSummary,onClick:()->Unit){
  Row(Modifier.fillMaxWidth().clickable(role=Role.Button,onClick=onClick).padding(vertical=12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
    Surface(Modifier.size(40.dp),shape=RoundedCornerShape(12.dp),color=domainColor(item.domain).copy(alpha=.16f)){Box(contentAlignment=Alignment.Center){Icon(lifeDomainIcon(item.domain),null,tint=domainColor(item.domain))}}
    Column(Modifier.weight(1f)){Text(item.title,maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.titleMedium);item.supporting?.let{Text(it,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
    item.trailing?.let{Text(it,style=MaterialTheme.typography.titleMedium)}
  }
}

@Composable fun <T> StateContent(state:LoadState<T>,onRetry:()->Unit,empty:String="这里还没有内容",content:@Composable (T)->Unit){when(state){
  LoadState.Loading->Column(Modifier.fillMaxWidth().padding(vertical=16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
    Text("正在加载",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    repeat(3){index->Box(Modifier.fillMaxWidth(if(index==2).65f else 1f).height(if(index==0)64.dp else 24.dp).background(MaterialTheme.colorScheme.surfaceVariant,RoundedCornerShape(12.dp)))}
  }
  is LoadState.Empty->EmptyState(state.reason.ifBlank{empty})
  is LoadState.Failed->SectionError(state.message,onRetry)
  is LoadState.Ready->{ReadStatus(state,onRetry);content(state.value)}
}}

@Composable fun ReadStatus(state:LoadState.Ready<*>,onRefresh:()->Unit){
  when{
    state.refreshing->Text("正在更新，当前内容仍可浏览",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    state.refreshError!=null->SectionError("更新失败，已保留当前内容：${state.refreshError}",onRefresh)
    state.updateAvailable->TextButton(onClick=onRefresh){Text("有新内容 · 点击更新")}
  }
}

@Composable fun EmptyState(message:String,actionLabel:String?=null,onAction:(()->Unit)?=null){Column(Modifier.fillMaxWidth().padding(vertical=28.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(10.dp)){Text(message,color=MaterialTheme.colorScheme.onSurfaceVariant);if(actionLabel!=null&&onAction!=null)TextButton(onClick=onAction){Text(actionLabel)}}}
@Composable fun SectionError(message:String,onRetry:()->Unit){Surface(Modifier.fillMaxWidth(),shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.errorContainer){Row(Modifier.padding(16.dp),verticalAlignment=Alignment.CenterVertically){Text(message,Modifier.weight(1f),color=MaterialTheme.colorScheme.onErrorContainer);IconButton(onClick=onRetry){Icon(Icons.Default.Refresh,"重试")}}}}

@Composable internal fun domainColor(domain:LifeDomain)=when(domain){LifeDomain.Health->lifeHealthAccent();LifeDomain.Meals->MaterialTheme.colorScheme.tertiary;LifeDomain.Money,LifeDomain.Travel,LifeDomain.Library->MaterialTheme.colorScheme.secondary}


fun lifeDomainIcon(domain:LifeDomain)=when(domain){
  LifeDomain.Health->Icons.Default.FavoriteBorder
  LifeDomain.Meals->Icons.Default.ShoppingCart
  LifeDomain.Money->Icons.Default.Star
  LifeDomain.Travel->Icons.Default.Place
  LifeDomain.Library->Icons.Default.Menu
}

@Composable fun LifeBackButton(onBack:()->Unit){IconButton(onClick=onBack){Icon(Icons.AutoMirrored.Filled.ArrowBack,"返回")}}

@Composable fun LifeTabs(selected:String,onSelect:(String)->Unit,items:List<Pair<String,String>>){
  Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
    items.forEach{(key,label)->FilterChip(selected=selected==key,onClick={onSelect(key)},label={Text(label)},shape=RoundedCornerShape(12.dp))}
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun LifeDateField(value:String,onChange:(String)->Unit,label:String="发生日期",enabled:Boolean=true){
  var open by rememberSaveable{mutableStateOf(false)}
  OutlinedButton(onClick={open=true},enabled=enabled,modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(12.dp),contentPadding=PaddingValues(16.dp)){
    Icon(Icons.Default.DateRange,null);Spacer(Modifier.width(12.dp))
    Column(Modifier.weight(1f)){Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(value.ifBlank{"未设置"},style=MaterialTheme.typography.bodyLarge)}
    Text("选择",style=MaterialTheme.typography.labelLarge)
  }
  if(open){
    val selected=runCatching{LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()}.getOrNull()
    val picker=rememberDatePickerState(initialSelectedDateMillis=selected)
    DatePickerDialog(onDismissRequest={open=false},confirmButton={TextButton(onClick={picker.selectedDateMillis?.let{onChange(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString())};open=false},enabled=picker.selectedDateMillis!=null){Text("选择")}},dismissButton={TextButton(onClick={open=false}){Text("取消")}}){DatePicker(picker)}
  }
}

/** Health retains its established green independently of the global blue accent. */
@Composable fun lifeHealthAccent():androidx.compose.ui.graphics.Color =
  if(MaterialTheme.colorScheme.background.luminance()<.5f)androidx.compose.ui.graphics.Color(0xFF7CEB52)
  else androidx.compose.ui.graphics.Color(0xFF346A23)

val LocalLifeAssistant=staticCompositionLocalOf<(() -> Unit)?>{null}

val LocalLifeMenu=staticCompositionLocalOf<List<Pair<String,()->Unit>>>{emptyList()}

/** Large fonts get complete metric rows rather than clipped values or units. */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun LifeMetricGrid(content:@Composable FlowRowScope.()->Unit){
  val density=androidx.compose.ui.platform.LocalDensity.current
  BoxWithConstraints(Modifier.fillMaxWidth()){
    FlowRow(Modifier.fillMaxWidth(),maxItemsInEachRow=if(density.fontScale>1.3f||maxWidth<300.dp)1 else 3,horizontalArrangement=Arrangement.spacedBy(12.dp),verticalArrangement=Arrangement.spacedBy(12.dp),content=content)
  }
}

@Composable fun LifeOptionalDateField(value:String,onChange:(String)->Unit,label:String){
  Column{
    LifeDateField(value,onChange,label)
    if(value.isNotBlank())TextButton(onClick={onChange("")}){Text("清除日期")}
  }
}

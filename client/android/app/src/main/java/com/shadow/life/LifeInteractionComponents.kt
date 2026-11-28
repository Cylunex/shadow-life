package com.shadow.life

import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import android.view.ViewTreeObserver
import android.view.Window
import androidx.compose.foundation.layout.*
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

@Composable internal fun LifeSystemBars(activityWindow: Window? = null) {
  val view = LocalView.current
  val window = activityWindow ?: (view.parent as? DialogWindowProvider)?.window ?: return
  val lightBackground = MaterialTheme.colorScheme.background.luminance() > .5f
  DisposableEffect(view, window, lightBackground) {
    fun applyAppearance() {
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.isAppearanceLightStatusBars = lightBackground
      controller.isAppearanceLightNavigationBars = lightBackground
    }
    applyAppearance()
    val listener = ViewTreeObserver.OnWindowFocusChangeListener { focused -> if (focused) applyAppearance() }
    view.viewTreeObserver.addOnWindowFocusChangeListener(listener)
    onDispose { if (view.viewTreeObserver.isAlive) view.viewTreeObserver.removeOnWindowFocusChangeListener(listener) }
  }
}

/** Full-screen task surface shared by editors and source readers. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun LifeFullScreen(
  title:String,onDismiss:()->Unit,actions:@Composable RowScope.()->Unit={},content:@Composable ()->Unit
){
  Dialog(onDismissRequest=onDismiss,properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)){
    LifeSystemBars()
    Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text(title)},navigationIcon={LifeBackButton(onDismiss)},actions=actions)}){padding->
      Box(Modifier.fillMaxSize().padding(padding).imePadding().navigationBarsPadding().padding(horizontal=20.dp)){content()}
    }
  }
}

@Composable internal fun LifeChoiceField(label:String,value:String,options:List<Pair<String,String>>,onSelect:(String)->Unit){
  var open by androidx.compose.runtime.remember{androidx.compose.runtime.mutableStateOf(false)}
  OutlinedButton(onClick={open=true},modifier=Modifier.fillMaxWidth()){
    Text(label,Modifier.weight(1f));Text(options.firstOrNull{it.first==value}?.second?:"选择")
  }
  if(open)LifeFullScreen(label,{open=false}){
    var query by androidx.compose.runtime.saveable.rememberSaveable{androidx.compose.runtime.mutableStateOf("")}
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
      LifeSearchBar(query,{query=it},"搜索")
      androidx.compose.foundation.lazy.LazyColumn(Modifier.selectableGroup()){
        val shown=options.filter{query.isBlank()||it.second.contains(query.trim(),ignoreCase=true)}
        if(shown.isEmpty())item{EmptyState("没有匹配项")}
        items(shown.size){index->
          val (key,title)=shown[index]
          val selected=key==value
          Surface(shape=MaterialTheme.shapes.small,color=if(selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface){
            Row(Modifier.fillMaxWidth().selectable(selected,role=Role.RadioButton){onSelect(key);open=false}
              .heightIn(min=52.dp).padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically){
              Text(title,Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge)
              if(selected)Icon(Icons.Default.Check,null)
            }
          }
        }
      }
    }
  }
}

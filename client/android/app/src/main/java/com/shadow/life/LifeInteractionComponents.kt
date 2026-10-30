package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** Full-screen task surface shared by editors and source readers. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun LifeFullScreen(title:String,onDismiss:()->Unit,content:@Composable ()->Unit){
  Dialog(onDismissRequest=onDismiss,properties=DialogProperties(usePlatformDefaultWidth=false)){
    Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text(title)},navigationIcon={LifeBackButton(onDismiss)})}){padding->
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
      OutlinedTextField(query,{query=it},modifier=Modifier.fillMaxWidth(),singleLine=true,label={Text("搜索")})
      androidx.compose.foundation.lazy.LazyColumn{
        val shown=options.filter{query.isBlank()||it.second.contains(query.trim(),ignoreCase=true)}
        if(shown.isEmpty())item{EmptyState("没有匹配项")}
        items(shown.size){index->val (key,title)=shown[index];TextButton(onClick={onSelect(key);open=false},modifier=Modifier.fillMaxWidth().heightIn(min=52.dp)){Text(title,Modifier.weight(1f));if(key==value)Text("✓")}}
      }
    }
  }
}

package com.shadow.life

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException

internal data class LibraryReference(val id:String,val revision:Int?) {
  fun verify(actualId:String,actualRevision:Int,state:String) {
    check(id==actualId && state=="active"){"此资料目前不可读取"}
    check(revision==null || revision==actualRevision){"资料已变化。引用的是修订 $revision，当前为 $actualRevision，请在 Life 中重新选择。"}
  }
  companion object {
    private val format=Regex("""shadow://life/library/(library_[A-Za-z0-9_-]{1,120})(?:\?revision=([1-9][0-9]{0,9}))?""")
    fun parse(value:String?):LibraryReference? {
      val match=format.matchEntire(value?:return null)?:return null
      val number=match.groups[2]?.value
      return LibraryReference(match.groupValues[1],if(number==null)null else number.toIntOrNull()?:return null)
    }
  }
}
internal data class ReferencedLibraryItem(val title:String,val revision:Int,val text:String?,val url:String?,val assets:List<DetailAsset>)

/** Only the active user's library is read. A URI never selects an account, server or command. */
class LibraryReferenceActivity:ComponentActivity(){
  private var visit by mutableIntStateOf(0)
  override fun onResume(){super.onResume();visit++}
  override fun onCreate(savedInstanceState:Bundle?){
    super.onCreate(savedInstanceState)
    val ref=if(intent.action==Intent.ACTION_VIEW) LibraryReference.parse(intent.dataString) else null
    val app=application as ShadowApp
    val repository=NativeLifeRepository(this,app)
    setContent{
      LifeTheme(AppearanceStore(this).current()){
        key(visit){
          val accountId=app.sessions.active()?.accountId
          var state by remember{mutableStateOf<LoadState<ReferencedLibraryItem>>(LoadState.Loading)}
          LaunchedEffect(ref,accountId){
            state=when{
              ref==null->LoadState.Failed("资料引用格式无效",false)
              accountId==null->LoadState.Failed("请先在 Life 登录，再打开此引用。",false)
              else->try{LoadState.Ready(repository.readLibraryReference(ref,accountId))}
              catch(error:CancellationException){throw error}
              catch(error:Exception){LoadState.Failed(error.message?:"当前账号无法读取这条资料")}
            }
          }
          Surface(Modifier.fillMaxSize()){
            Column(Modifier.safeDrawingPadding().padding(20.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){
              Row{TextButton(onClick={finish()}){Text("返回")}; Text("资料引用",style=MaterialTheme.typography.titleLarge)}
              val current=state
              when(current){
                is LoadState.Loading->Text("正在核对当前账号和资料修订…")
                is LoadState.Ready->{
                  Text(current.value.title,style=MaterialTheme.typography.headlineSmall)
                  Text("修订 ${current.value.revision}")
                  current.value.text?.takeIf{it.isNotBlank()}?.let{SelectionContainer{Text(it)}}
                  current.value.url?.let{SelectionContainer{Text(it)}}
                  if(accountId!=null&&current.value.assets.isNotEmpty())LibraryOriginals(accountId,current.value.assets)
                }
                is LoadState.Failed->{Text(current.message);if(current.retryable)TextButton(onClick={visit++}){Text("重新核对")}}
                is LoadState.Empty->Text(current.reason)
              }
            }
          }
        }
      }
    }
  }
}

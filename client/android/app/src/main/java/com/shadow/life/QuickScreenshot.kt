package com.shadow.life
import android.app.*
import android.content.*
import android.graphics.Bitmap
import android.os.*
import android.service.quicksettings.TileService
import android.view.Display
import android.widget.Toast
import androidx.annotation.RequiresApi
import kotlinx.coroutines.*
import org.json.*
import java.io.*
import java.time.*
import java.util.UUID

class LifeScreenshotTile:TileService(){
 override fun onStartListening(){super.onStartListening();qsTile?.let{it.state=if(Build.VERSION.SDK_INT>=30)android.service.quicksettings.Tile.STATE_ACTIVE else android.service.quicksettings.Tile.STATE_UNAVAILABLE;it.updateTile()}}
 override fun onClick(){super.onClick();if(isLocked){unlockAndRun{openCapture()}}else openCapture()}
 private fun openCapture(){val intent=Intent(this,QuickScreenshotActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);if(Build.VERSION.SDK_INT>=34)startActivityAndCollapse(PendingIntent.getActivity(this,5203,intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)) else @Suppress("DEPRECATION") startActivityAndCollapse(intent)}
}
class QuickScreenshotActivity:Activity(){
 override fun onCreate(state:Bundle?){super.onCreate(state)
  if((application as ShadowApp).sessions.active()==null){Toast.makeText(this,"请先登录 Life，再使用截图收录",Toast.LENGTH_LONG).show();finish();return}
  val capture=LifeScreenCaptureService.active
  if(Build.VERSION.SDK_INT<30||capture==null){Toast.makeText(this,"请先启用 Life 屏幕内容服务，或使用系统截图后分享给 Life",Toast.LENGTH_LONG).show();finish();return}
  // Close the shade/activity before asking Android for the underlying app's display.
  finish();Handler(Looper.getMainLooper()).postDelayed({capture.captureRequestedScreenshot()},700)
 }
}
@RequiresApi(30)
internal fun LifeScreenCaptureService.captureRequestedScreenshot(){
 val app=application as ShadowApp;val session=app.sessions.active()?:return
 val observedAt=Instant.now();val root=rootInActiveWindow;val sourcePackage=root?.packageName?.toString();val visibleText=root?.let{readCapturePage(it)}
 if(sourcePackage=="com.android.systemui"){Toast.makeText(this,"快捷面板尚未收起，请稍后重试",Toast.LENGTH_LONG).show();return}
 takeScreenshot(Display.DEFAULT_DISPLAY,mainExecutor,object:android.accessibilityservice.AccessibilityService.TakeScreenshotCallback{
  override fun onSuccess(result:android.accessibilityservice.AccessibilityService.ScreenshotResult){
   val currentRoot=rootInActiveWindow
   val matchedText=visibleText?.takeIf{currentRoot?.packageName?.toString()==sourcePackage&&currentRoot?.let{node->readCapturePage(node)}==it}
   val hardware=result.hardwareBuffer
   val bitmap=try{Bitmap.wrapHardwareBuffer(hardware,result.colorSpace)?.let{source->try{source.copy(Bitmap.Config.ARGB_8888,false)}finally{source.recycle()}}}finally{hardware.close()}
   if(bitmap==null){Toast.makeText(this@captureRequestedScreenshot,"截图不可读取",Toast.LENGTH_LONG).show();return}
   CoroutineScope(SupervisorJob()+Dispatchers.IO).launch{
    try{
     if(app.sessions.active()?.accountId!=session.accountId)return@launch
     val bytes=ByteArrayOutputStream();check(bitmap.compress(Bitmap.CompressFormat.PNG,100,bytes));check(bytes.size()<=10_000_000){"截图超过大小限制"}
     val id="screenshot_${UUID.randomUUID().toString().replace("-","")}";val now=observedAt;val metadata=JSONObject().put("capability","life.capture_screenshot").put("input",JSONObject().put("title","截图 ${LocalDateTime.now()}").put("captured_at",now.toString()).put("time_zone",ZoneId.systemDefault().id))
     if(matchedText!=null&&sourcePackage!=null)metadata.getJSONObject("input").put("text",matchedText).put("app_package",sourcePackage)
     app.queue.enqueueAttachment(session,id,"cmd_$id","image/png",LocalDate.now().toString(),"截图收录",bytes.toByteArray().inputStream(),File(filesDir,"attachments/$id.enc"),metadata.toString());SyncScheduler.schedule(this@captureRequestedScreenshot,session.accountId)
     withContext(Dispatchers.Main){Toast.makeText(this@captureRequestedScreenshot,"截图已加密保存，正在同步到 Life",Toast.LENGTH_LONG).show()}
    }catch(e:CancellationException){throw e}catch(_:Exception){withContext(Dispatchers.Main){Toast.makeText(this@captureRequestedScreenshot,"截图未保存，请回到 Life 检查账号和存储",Toast.LENGTH_LONG).show()}}finally{bitmap.recycle()}
   }
  }
  override fun onFailure(errorCode:Int){Toast.makeText(this@captureRequestedScreenshot,"系统未允许截图，请在页面稳定后重试；受保护页面无法截取",Toast.LENGTH_LONG).show()}
 })
}

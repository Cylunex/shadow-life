package com.shadow.life

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.*
import android.os.Build
import android.view.Display
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.*
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.LocalDate
import java.util.UUID
import org.json.JSONObject

private suspend fun AccessibilityService.orderScreenshot():Bitmap=suspendCancellableCoroutine{continuation->
 if(Build.VERSION.SDK_INT<30){continuation.resumeWithException(IllegalStateException("自动长页采集需要 Android 11，请分享系统长截图"));return@suspendCancellableCoroutine}
 takeScreenshot(Display.DEFAULT_DISPLAY,mainExecutor,object:AccessibilityService.TakeScreenshotCallback{
  override fun onSuccess(result:AccessibilityService.ScreenshotResult){
   val buffer=result.hardwareBuffer
   val bitmap=try{Bitmap.wrapHardwareBuffer(buffer,result.colorSpace)?.let{try{it.copy(Bitmap.Config.ARGB_8888,false)}finally{it.recycle()}}}finally{buffer.close()}
   if(bitmap==null){if(continuation.isActive)continuation.resumeWithException(IllegalStateException("截图不可读取"))}
   else if(continuation.isActive)continuation.resume(bitmap) else bitmap.recycle()
  }
  override fun onFailure(errorCode:Int){android.util.Log.w("LifeShake","Screenshot unavailable; code=$errorCode");if(continuation.isActive)continuation.resumeWithException(IllegalStateException("页面暂不可截图，请稍后重试或分享系统长截图"))}
 })
}
private suspend fun AccessibilityService.orderSwipeForward(width:Int,height:Int):Boolean=suspendCancellableCoroutine{c->
 val (startY,endY)=takeoutForwardSwipeY(height)
 val path=Path().apply{moveTo(width*.5f,startY);lineTo(width*.5f,endY)}
 val gesture=GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path,0,650)).build()
 val submitted=dispatchGesture(gesture,object:AccessibilityService.GestureResultCallback(){override fun onCompleted(g:GestureDescription){if(c.isActive)c.resume(true)};override fun onCancelled(g:GestureDescription){if(c.isActive)c.resume(false)}},null)
 if(!submitted&&c.isActive)c.resume(false)
}
/** An intentional shake starts a bounded session. The user chooses every next viewport. */
internal suspend fun LifeScreenCaptureService.collectTakeoutOrder(account:String,pkg:String)=withContext(Dispatchers.Main){
 val app=application as ShadowApp
 val initial=rootInActiveWindow?:error("当前页面不可读取");val window=initial.windowId;initial.recycle()
 val bounds=if(Build.VERSION.SDK_INT>=30)getSystemService(android.view.WindowManager::class.java).currentWindowMetrics.bounds else Rect(0,0,resources.displayMetrics.widthPixels,resources.displayMetrics.heightPixels)
 val width=bounds.width();val screenHeight=bounds.height()
 fun sourceRoot():AccessibilityNodeInfo {
  // Touching our overlay must not redirect reads to its buttons. The underlying
  // focused application window must still be exactly the original source window.
  val available=windows
  val root=try{
   val focused=available.firstOrNull{it.type==android.view.accessibility.AccessibilityWindowInfo.TYPE_APPLICATION&&it.isFocused}
   if(focused!=null){check(focused.id==window){"订单页面已切换，采集已停止"};focused.root}
   else rootInActiveWindow
  }finally{available.forEach{it.recycle()}}
  checkNotNull(root){"当前页面不可读取"}
  try{check(root.packageName?.toString()==pkg&&root.windowId==window){"订单页面已切换，采集已停止"};return root}catch(e:Throwable){root.recycle();throw e}
 }
 fun checkPage(){
  check(app.sessions.active()?.accountId==account){"账号已切换，采集已停止"}
  check(getSharedPreferences("activity_capture",0).getBoolean(shakeKey(account,pkg),false)){"摇一摇已关闭"}
  val power=getSystemService(android.os.PowerManager::class.java);val lock=getSystemService(android.app.KeyguardManager::class.java)
  check(power.isInteractive&&!lock.isKeyguardLocked){"锁屏后停止采集"}
  sourceRoot().recycle()
 }
 suspend fun nativeFrame():List<OrderTextBox>?{
  checkPage()
  val result=orderReader.read{val root=sourceRoot();readTakeoutNodeBoxes(root,width,screenHeight)}
  checkPage();return result
 }
 val activity=orderActivity(pkg,window)
 val candidate=attemptsNativeOrderText(pkg,activity)
 val firstNative=if(candidate)nativeFrame().orEmpty() else emptyList()
 val native=takeoutPackages[pkg]=="meituan"&&isTakeoutPage(firstNative,pkg in dedicatedTakeoutPackages)
 android.util.Log.i("LifeShake","Order route=${if(native)"accessibility" else "long_screenshot"}; activity=$activity; native_boxes=${firstNative.size}")
 val control=OrderCaptureControl();val overlay=OrderCaptureOverlay(this@collectTakeoutOrder,control)
 val frames=mutableListOf<Pair<Int,Bitmap>>()
 val imageProgress=OrderImageProgress(width,screenHeight)
 var combined=firstNative;var previous=firstNative;var offset=0;var pages=1;var stopNote:String?=null;var nextAllowed=true
 suspend fun imageFrame():Bitmap{
  checkPage();overlay.visible(false)
  try{delay(180);checkPage();val bitmap=orderScreenshot();try{checkPage();check(bitmap.width==width&&bitmap.height==screenHeight){"屏幕尺寸已变化，请重新开始采集"};return bitmap}catch(e:Throwable){bitmap.recycle();throw e}}finally{overlay.visible(true)}
 }
 try{
  if(!native){check(screenHeight<=18000&&width.toLong()*screenHeight<=24_000_000){"当前屏幕超过截图大小限制"};frames+=0 to imageFrame()}
  val deadline=android.os.SystemClock.elapsedRealtime()+300_000
  while(true){
   checkPage()
   val ended=native&&takeoutEnded(combined)
   nextAllowed=nextAllowed&&pages<12
   val note=if(pages>=12)"已到 12 屏上限，请完成保存或取消" else stopNote
   overlay.status("${if(native)"美团无障碍文字" else if(imageProgress.separateImages)"逐屏截图（含重叠）" else "长截图"} · $pages 屏${note?.let{"\n$it"}?:if(ended)" · 已读到合计，可完成" else ""}",nextAllowed=nextAllowed)
   var action:OrderCaptureAction?=null
   while(action==null){checkPage();action=withTimeoutOrNull(800){control.awaitAction()};check(action!=null||android.os.SystemClock.elapsedRealtime()<deadline){"采集等待超时，未保存；请重新摇动开始"}}
   if(action==OrderCaptureAction.Cancel)throw CancellationException("用户取消采集")
   if(action==OrderCaptureAction.Finish)break
   if(control.terminal==OrderCaptureAction.Cancel)throw CancellationException("用户取消采集")
   if(control.terminal==OrderCaptureAction.Finish)break
   if(!nextAllowed)continue
   stopNote=null
   overlay.status("正在读取下一屏…",true)
   checkPage();check(orderSwipeForward(width,screenHeight)){"滚动被中断"};delay(700)
   if(control.terminal==OrderCaptureAction.Cancel)throw CancellationException("用户取消采集")
   if(native){
    val next=nativeFrame()
    if(next==null){stopNote="后续文字暂不可读，可重试下一屏或完成已有范围";continue}
    if(takeoutViewportUnchanged(previous,next,screenHeight)){stopNote="画面未移动，可重试下一屏或完成保存";continue}
    val delta=takeoutScrollOffset(previous,next,screenHeight)
    if(delta==null){stopNote="文字未可靠对齐，请完成已有范围后补充采集";nextAllowed=false;continue}
    val newOffset=offset+delta
    if(newOffset+screenHeight>18000){stopNote="已到文字高度上限，请完成保存或取消";nextAllowed=false;continue}
    combined=mergeTakeoutBoxes(combined,next,newOffset,offset,screenHeight);offset=newOffset;previous=next
   }else{
    val next=imageFrame()
    val delta=try{withContext(Dispatchers.Default){orderImageOffset(orderImageSample(frames.last().second),orderImageSample(next),screenHeight)}}catch(e:Throwable){next.recycle();throw e}
    if(!imageProgress.add(delta)){next.recycle();stopNote="画面未移动，可重试下一屏或完成保存";continue}
    if(!imageProgress.separateImages)offset=imageProgress.height-screenHeight
    frames+=offset to next
    android.util.Log.i("LifeShake","Order next captured; pages=${imageProgress.pages}; overlap=${delta?:"unknown"}; separate_images=${imageProgress.separateImages}; waiting_for_finish=true")
    if(imageProgress.separateImages)stopNote="本次保留每屏原图，完成后一起识别；可继续下一屏"
   }
   pages++
   // Finish during a swipe includes the resulting viewport; no subsequent swipe is submitted.
   if(control.terminal==OrderCaptureAction.Finish)break
  }
  checkPage();if(control.terminal==OrderCaptureAction.Cancel)throw CancellationException("用户取消采集")
  control.requireFinish()
  android.util.Log.i("LifeShake","Order finish selected; pages=$pages; route=${if(native)"accessibility" else if(imageProgress.separateImages)"separate_images" else "long_screenshot"}")
  val now=Instant.now();val id="order_${UUID.randomUUID().toString().replace("-","")}"
  if(native){
   val complete=takeoutEnded(combined)
   val text=takeoutEnvelope("meituan",width,offset+screenHeight,combined,complete)
   val item=JSONObject().put("source_id",id).put("kind","screen_text").put("title",if(complete)"美团订单 · 无障碍" else "美团订单 · 部分无障碍文字").put("text",text).put("app_package",pkg).put("started_at",now.toString()).put("ended_at",now.toString()).put("time_zone",ZoneId.systemDefault().id)
   NativeLifeRepository(this@collectTakeoutOrder,app).saveActivities(org.json.JSONArray().put(item),account)
   BillShakeStatus.message=(if(complete)"美团订单文字已保存，未使用截图或 OCR" else "已保存所选范围的订单文字；商品或订单信息可能不完整")+(stopNote?.let{"；$it"}?:"")
  }else{
   // Preserve every original when overlap is uncertain. Do not fabricate a stitch
   // or discard the newly captured viewport; Losna receives one shared batch.
   val images=if(imageProgress.separateImages)frames.map{it.second} else {
    val height=offset+screenHeight
    val image=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);val canvas=Canvas(image);canvas.drawColor(Color.WHITE)
    for(i in frames.indices){val (y,bitmap)=frames[i];val start=if(i==0)0 else (y+frames[i-1].first+screenHeight)/2;val end=if(i==frames.lastIndex)height else (frames[i+1].first+y+screenHeight)/2
     canvas.drawBitmap(bitmap,Rect(0,start-y,width,end-y),Rect(0,start,width,end),null)
    }
    listOf(image)
   }
   val encoded=try{withContext(Dispatchers.Default){images.map{bitmap->ByteArrayOutputStream().also{check(bitmap.compress(Bitmap.CompressFormat.JPEG,90,it))}.toByteArray().also{check(it.size<=10_000_000){"截图超过上传限制，请缩短采集范围"}}}}}finally{if(!imageProgress.separateImages)images.forEach{it.recycle()}}
   checkPage();control.requireFinish()
   val input=OrderCaptureSettings.apply(this@collectTakeoutOrder,account,JSONObject().put("captured_at",now.toString()).put("time_zone",ZoneId.systemDefault().id).put("app_package",pkg).put("batch_id",id))
   withContext(Dispatchers.IO){val session=app.sessions.active()?.takeIf{it.accountId==account}?:error("账号已切换")
    encoded.forEachIndexed{i,bytes->
     val attachmentId=if(encoded.size==1)id else "${id}_${i+1}"
     val title=if(imageProgress.separateImages)"订单逐屏截图 · 第 ${i+1}/$pages 屏（含重叠）" else "订单长截图 · $pages 屏"
     val metadata=JSONObject().put("capability","life.capture_screenshot").put("input",JSONObject(input.toString()).put("title",title))
     app.queue.enqueueAttachment(session,attachmentId,"cmd_$attachmentId","image/jpeg",LocalDate.now().toString(),title,bytes.inputStream(),File(filesDir,"attachments/$attachmentId.enc"),metadata.toString())
    }
    SyncScheduler.schedule(this@collectTakeoutOrder,account)
   }
   val route=when(input.getString("recognition")){"llm"->"同步后请求所选 LLM 识图，结果见资料详情";"save"->"可在资料详情手动选择 LLM 识图";else->"同步后交给 Losna 识别"}
   BillShakeStatus.message="已保存 $pages 屏${if(imageProgress.separateImages)"原图（同一批次，含重叠）" else "长截图"}，$route"
  }
 }catch(e:CancellationException){if(control.terminal==OrderCaptureAction.Cancel)BillShakeStatus.message="本次采集已取消，未保存";throw e}
 finally{try{overlay.close()}finally{frames.forEach{it.second.recycle()}}}
}

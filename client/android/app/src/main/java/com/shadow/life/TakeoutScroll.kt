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
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.LocalDate
import java.util.UUID
import org.json.JSONObject

private suspend fun AccessibilityService.orderScreenshot(window:Int):Bitmap=suspendCancellableCoroutine{continuation->
 if(Build.VERSION.SDK_INT<30){continuation.resumeWithException(IllegalStateException("自动长页采集需要 Android 11，请分享系统长截图"));return@suspendCancellableCoroutine}
 val callback=object:AccessibilityService.TakeScreenshotCallback{
  override fun onSuccess(result:AccessibilityService.ScreenshotResult){
   val buffer=result.hardwareBuffer
   val bitmap=try{Bitmap.wrapHardwareBuffer(buffer,result.colorSpace)?.let{try{it.copy(Bitmap.Config.ARGB_8888,false)}finally{it.recycle()}}}finally{buffer.close()}
   if(bitmap==null){if(continuation.isActive)continuation.resumeWithException(IllegalStateException("截图不可读取"))}
   else if(continuation.isActive)continuation.resume(bitmap) else bitmap.recycle()
  }
  override fun onFailure(errorCode:Int){android.util.Log.w("LifeShake","Screenshot unavailable; code=$errorCode");if(continuation.isActive)continuation.resumeWithException(IllegalStateException("页面暂不可截图，请稍后重试或分享系统长截图"))}
 }
 if(Build.VERSION.SDK_INT>=34) takeScreenshotOfWindow(window,mainExecutor,callback) else takeScreenshot(Display.DEFAULT_DISPLAY,mainExecutor,callback)
}
private suspend fun AccessibilityService.orderSwipeForward(width:Int,height:Int):Boolean=suspendCancellableCoroutine{c->
 val (startY,endY)=takeoutForwardSwipeY(height)
 val path=Path().apply{moveTo(width*.5f,startY);lineTo(width*.5f,endY)}
 val gesture=GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path,0,650)).build()
 val submitted=dispatchGesture(gesture,object:AccessibilityService.GestureResultCallback(){override fun onCompleted(g:GestureDescription){if(c.isActive)c.resume(true)};override fun onCancelled(g:GestureDescription){if(c.isActive)c.resume(false)}},null)
 if(!submitted&&c.isActive)c.resume(false)
}
/** An intentional shake starts a bounded session. Only explicit finish enqueues the captured material. */
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
 val control=OrderCaptureControl();val overlay=OrderCaptureOverlay(this@collectTakeoutOrder,control,!native)
 val frames=mutableListOf<ByteArray>()
 lateinit var imageProgress:OrderImageProgress
 var imageWidth=width;var imageHeight=screenHeight
 var manual=false
 var previousImage:OrderImageSample?=null
 var pendingSample:OrderImageSample?=null
 var stalled=0
 var combined=firstNative;var previous=firstNative;var offset=0;var pages=1;var stopNote:String?=null;var nextAllowed=true
 var lastScreenshotAt=0L
 suspend fun imageFrame():Bitmap{
  delay((550L-(android.os.SystemClock.elapsedRealtime()-lastScreenshotAt)).coerceAtLeast(0L))
  checkPage();if(Build.VERSION.SDK_INT<34)overlay.visible(false)
  try{if(Build.VERSION.SDK_INT<34)delay(180);checkPage();lastScreenshotAt=android.os.SystemClock.elapsedRealtime();val bitmap=orderScreenshot(window);try{checkPage();check(frames.isEmpty() || bitmap.width==imageWidth&&bitmap.height==imageHeight){"屏幕尺寸已变化，请重新开始采集"};return bitmap}catch(e:Throwable){bitmap.recycle();throw e}}finally{overlay.visible(true)}
 }
 suspend fun captureViewport(waitForStill:Boolean=false):Boolean {
  val bitmap=imageFrame()
  try {
   return withContext(Dispatchers.Default) {
    val sample=orderImageSample(bitmap)
    val previousSample=previousImage
    if(previousSample==null){
     imageWidth=bitmap.width;imageHeight=bitmap.height
     check(imageHeight<=18000 && imageWidth.toLong()*imageHeight<=24_000_000){"当前屏幕超过截图大小限制"}
     imageProgress=OrderImageProgress(imageWidth,imageHeight)
    } else {
     if(orderImageStill(previousSample,sample)){pendingSample=null;return@withContext false}
     if(waitForStill){
      val pending=pendingSample
      pendingSample=sample
      if(pending==null || !orderImageStill(pending,sample))return@withContext false
     }
     // Changed pixels with an apparent zero shift may be an expanding row.
     // Keep that viewport as a new segment instead of dropping its evidence.
     val delta=orderImageOffset(previousSample,sample,imageHeight)
     if(!imageProgress.add(delta?.takeIf{it>=16}))return@withContext false
    }
    frames.add(bitmap.orderImageBytes())
    previousImage=sample;pendingSample=null;pages=frames.size
    true
   }
  } finally { bitmap.recycle() }
 }
 try{
  if(!native)captureViewport()
  val deadline=android.os.SystemClock.elapsedRealtime()+300_000
  while(true){
   checkPage()
   val ended=native&&takeoutEnded(combined)
   nextAllowed=nextAllowed && (if(native) pages<12 else imageProgress.canReadNext && frames.sumOf{it.size.toLong()}<32_000_000)
   val note=if(!nextAllowed && (!native || pages>=12))"已到采集上限，请完成保存或取消" else stopNote
   val mode=if(native)"美团无障碍文字" else if(manual)"手动慢滑，停稳收录" else "自动滚动"
   overlay.manual(manual)
   overlay.status("$mode · $pages 屏"+(note?.let{"\n$it"}?:if(ended)" · 已读到合计，可完成" else ""),nextAllowed=nextAllowed)
   check(android.os.SystemClock.elapsedRealtime()<deadline){"采集等待超时，未保存"}
   val action=withTimeoutOrNull(800){control.awaitAction()}
   if(control.terminal==OrderCaptureAction.Cancel)throw CancellationException("用户取消采集")
   if(control.terminal==OrderCaptureAction.Finish){
    if(!native && manual && nextAllowed)captureViewport()
    break
   }
   if(!nextAllowed)continue
   if(action==OrderCaptureAction.ToggleMode){
    manual=!manual;pendingSample=null;stalled=0;stopNote=null;continue
   }
   if(native && action!=OrderCaptureAction.Next)continue
   if(!native && manual){
    captureViewport(waitForStill=true)
    continue
   }
   stopNote=null
   overlay.status("正在读取下一屏…",true)
   checkPage()
   if(!orderSwipeForward(width,screenHeight)){
    if(native){stopNote="滚动被中断，可重试";continue}
    manual=true;stopNote="滑动被中断，可手动慢滑或完成";continue
   }
   delay(700)
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
    pages++
   }else{
    if(captureViewport())stalled=0 else stalled++
    if(stalled>=2){manual=true;stopNote="画面已停止，可完成或手动慢滑"}
   }
   // Finish during a swipe includes the resulting viewport; no subsequent swipe is submitted.
   if(control.terminal==OrderCaptureAction.Finish)break
  }
  checkPage();if(control.terminal==OrderCaptureAction.Cancel)throw CancellationException("用户取消采集")
  control.requireFinish()
  android.util.Log.i("LifeShake","Order finish selected; pages=$pages; route=${if(native)"accessibility" else "long_screenshot"}")
  val now=Instant.now();val id="order_${UUID.randomUUID().toString().replace("-","")}"
  if(native){
   val complete=takeoutEnded(combined)
   val text=takeoutEnvelope("meituan",width,offset+screenHeight,combined,complete)
   val item=JSONObject().put("source_id",id).put("kind","screen_text").put("title",if(complete)"美团订单 · 无障碍" else "美团订单 · 部分无障碍文字").put("text",text).put("app_package",pkg).put("started_at",now.toString()).put("ended_at",now.toString()).put("time_zone",ZoneId.systemDefault().id)
   NativeLifeRepository(this@collectTakeoutOrder,app).saveActivities(org.json.JSONArray().put(item),account)
   BillShakeStatus.message=(if(complete)"美团订单文字已保存，未使用截图或 OCR" else "已保存所选范围的订单文字；商品或订单信息可能不完整")+(stopNote?.let{"；$it"}?:"")
  }else{
   val encoded=withContext(Dispatchers.Default){encodeOrderSegments(frames,imageProgress.segments,imageWidth,imageHeight)}
   checkPage();control.requireFinish()
   val input=OrderCaptureSettings.apply(this@collectTakeoutOrder,account,JSONObject().put("captured_at",now.toString()).put("time_zone",ZoneId.systemDefault().id).put("app_package",pkg).put("batch_id",id))
   withContext(Dispatchers.IO){val session=app.sessions.active()?.takeIf{it.accountId==account}?:error("账号已切换")
    encoded.forEachIndexed{i,bytes->
     val attachmentId=if(encoded.size==1)id else "${id}_${i+1}"
     val title=if(encoded.size>1)"订单长截图 · 第 ${i+1}/${encoded.size} 段（含重叠）" else "订单长截图 · $pages 屏"
     val metadata=JSONObject().put("capability","life.capture_screenshot").put("input",JSONObject(input.toString()).put("title",title))
     app.queue.enqueueAttachment(session,attachmentId,"cmd_$attachmentId","image/jpeg",LocalDate.now().toString(),title,bytes.inputStream(),File(filesDir,"attachments/$attachmentId.enc"),metadata.toString())
    }
    SyncScheduler.schedule(this@collectTakeoutOrder,account)
   }
   val route=when(input.getString("recognition")){"llm"->"同步后请求所选 LLM 识图，结果见资料详情";"save"->"可在资料详情手动选择 LLM 识图";else->"同步后交给 Losna 识别"}
   BillShakeStatus.message="已保存 $pages 屏${if(encoded.size>1)"，共 ${encoded.size} 段" else "长截图"}，$route"
  }
 }catch(e:CancellationException){if(control.terminal==OrderCaptureAction.Cancel)BillShakeStatus.message="本次采集已取消，未保存";throw e}
 finally{overlay.close()}
}

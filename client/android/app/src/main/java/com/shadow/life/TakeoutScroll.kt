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
  override fun onFailure(errorCode:Int){if(continuation.isActive)continuation.resumeWithException(IllegalStateException("页面暂不可截图，请稍后重试或分享系统长截图"))}
 })
}
private suspend fun AccessibilityService.orderSwipe(width:Int,height:Int,down:Boolean):Boolean=suspendCancellableCoroutine{c->
 val path=Path().apply{moveTo(width*.5f,height*(if(down).42f else .78f));lineTo(width*.5f,height*(if(down).78f else .42f))}
 val gesture=GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path,0,400)).build()
 val submitted=dispatchGesture(gesture,object:AccessibilityService.GestureResultCallback(){override fun onCompleted(g:GestureDescription){if(c.isActive)c.resume(true)};override fun onCancelled(g:GestureDescription){if(c.isActive)c.resume(false)}},null)
 if(!submitted&&c.isActive)c.resume(false)
}
private fun expandKnownOrderSection(root:AccessibilityNodeInfo):Boolean {
 val queue=java.util.ArrayDeque<AccessibilityNodeInfo>();queue.add(root);var count=0
 try{while(queue.isNotEmpty()&&count++<600){val node=queue.removeFirst();try{
  val text=listOfNotNull(node.text,node.contentDescription).joinToString(" ")
  val state=if(Build.VERSION.SDK_INT>=30)node.stateDescription?.toString().orEmpty() else ""
  if(node.isVisibleToUser&&node.isClickable&&(text.contains("价格明细")||text.contains("订单信息"))&&(text.contains("展开")||state.contains("折叠")))return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
  for(i in 0 until node.childCount)node.getChild(i)?.let(queue::add)
 }finally{node.recycle()}};return false}finally{queue.forEach{it.recycle()}}
}
/** Only called after an explicit shake in an enabled takeout app. Never taps payment or navigation. */
internal suspend fun LifeScreenCaptureService.collectTakeoutOrder(account:String,pkg:String)=withContext(Dispatchers.Main){withTimeout(90_000){
 val app=application as ShadowApp;val platform=takeoutPackages.getValue(pkg)
 val initial=rootInActiveWindow?:error("当前页面不可读取");val window=initial.windowId;initial.recycle()
 fun checkPage(){
  check(app.sessions.active()?.accountId==account){"账号已切换，采集已停止"}
  check(getSharedPreferences("activity_capture",0).getBoolean(shakeKey(account,pkg),false)){"摇一摇已关闭"}
  val power=getSystemService(android.os.PowerManager::class.java);val lock=getSystemService(android.app.KeyguardManager::class.java)
  check(power.isInteractive&&!lock.isKeyguardLocked){"锁屏后停止采集"}
  val root=rootInActiveWindow?:error("页面已离开");try{check(root.packageName?.toString()==pkg&&root.windowId==window){"订单页面已切换，采集已停止"}}finally{root.recycle()}
 }
 val frames=mutableListOf<Pair<Int,Bitmap>>()
 TakeoutOcr().use{ocr->
  suspend fun frame():Pair<Bitmap,List<OrderTextBox>>{checkPage();val bitmap=orderScreenshot();try{val boxes=ocr.read(bitmap);checkPage();return bitmap to boxes}catch(e:Throwable){bitmap.recycle();throw e}}
  var first=frame()
  // A shake can start midway down an order. Its brand/title may be offscreen,
  // and accessible WebView text can retain a heading that OCR splits or misses.
  val orderPage=try{
   checkPage()
   val knownTakeoutApp=pkg in dedicatedTakeoutPackages
   isTakeoutPage(first.second,knownTakeoutApp)||rootInActiveWindow?.let{root->isTakeoutDetailText(readCapturePage(root).orEmpty(),knownTakeoutApp)}==true
  }catch(e:Throwable){first.first.recycle();throw e}
  if(!orderPage){first.first.recycle();error("未识别出单笔订单明细，请展开商品或订单信息后重试，也可分享系统长截图")}
  try{
   // Return to the top before collecting; bounded and checked after every movement.
   var atTop=false
   for(attempt in 0 until 10){
    val old=takeoutText(first.second)
    checkPage();check(orderSwipe(first.first.width,first.first.height,true)){"滚动被中断"};delay(650)
    val next=frame();first.first.recycle();first=next
    if(takeoutText(next.second)==old){atTop=true;break}
   }
   check(atTop){"未能回到订单顶部，请手动回顶部后重试"}
   val width=first.first.width;val screenHeight=first.first.height
   frames+=0 to first.first;var previous=first.second;var combined=previous;var offset=0;var complete=false
   for(index in 0 until 12){
    checkPage()
    val root=rootInActiveWindow
    if(root!=null&&expandKnownOrderSection(root)){
     delay(650);val refreshed=frame();frames.last().second.recycle();frames[frames.lastIndex]=offset to refreshed.first
     combined=combined.filter{it.y<offset}+refreshed.second.map{it.copy(y=it.y+offset)};previous=refreshed.second
    }
    if(takeoutEnded(combined)){complete=true;break}
    checkPage();check(orderSwipe(width,screenHeight,false)){"滚动被中断"};delay(650)
    val next=frame()
    if(takeoutText(previous)==takeoutText(next.second)){next.first.recycle();break}
    val delta=takeoutScrollOffset(previous,next.second,screenHeight)
    if(delta==null){next.first.recycle();error("跨屏内容无法可靠对齐，请使用系统长截图分享给 Life")}
    val nextOffset=offset+delta
    if(nextOffset+screenHeight>18000||width.toLong()*(nextOffset+screenHeight)>24_000_000){next.first.recycle();error("订单过长，请使用系统长截图分享")}
    combined=mergeTakeoutBoxes(combined,next.second,nextOffset,offset,screenHeight);offset=nextOffset;previous=next.second;frames+=offset to next.first
   }
   val height=offset+screenHeight;val text=takeoutEnvelope(platform,width,height,combined,complete)
   val image=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);val canvas=Canvas(image);canvas.drawColor(Color.WHITE)
   for(i in frames.indices){val (y,bitmap)=frames[i];val start=if(i==0)0 else (y+frames[i-1].first+screenHeight)/2;val end=if(i==frames.lastIndex)height else (frames[i+1].first+y+screenHeight)/2
    canvas.drawBitmap(bitmap,Rect(0,start-y,width,end-y),Rect(0,start,width,end),null)
   }
   val bytes=try{ByteArrayOutputStream().also{check(image.compress(Bitmap.CompressFormat.JPEG,90,it))}.toByteArray()}finally{image.recycle()}
   check(bytes.size<=10_000_000){"截图超过上传限制"};checkPage()
   val now=Instant.now();val id="takeout_${UUID.randomUUID().toString().replace("-","")}"
   val metadata=JSONObject().put("capability","life.capture_screenshot").put("input",JSONObject().put("title",if(complete)"摇一摇外卖订单" else "外卖订单 · 部分页面").put("captured_at",now.toString()).put("time_zone",ZoneId.systemDefault().id).put("app_package",pkg).put("text",text))
   withContext(Dispatchers.IO){val session=app.sessions.active()?.takeIf{it.accountId==account}?:error("账号已切换")
    app.queue.enqueueAttachment(session,id,"cmd_$id","image/jpeg",LocalDate.now().toString(),"外卖订单",bytes.inputStream(),File(filesDir,"attachments/$id.enc"),metadata.toString());SyncScheduler.schedule(this@collectTakeoutOrder,account)
   }
   BillShakeStatus.message=if(complete)"订单与长截图已保存，可到 Life「订单」查看" else "已保存部分订单，请展开价格明细／订单信息后补充截图"
  }finally{if(frames.isEmpty())first.first.recycle();frames.forEach{it.second.recycle()}}
 }
}}

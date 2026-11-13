package com.shadow.life

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.channels.Channel

internal enum class OrderCaptureAction { Next, ToggleMode, Finish, Cancel }
internal class OrderCaptureControl {
 private val requests=Channel<OrderCaptureAction>(Channel.CONFLATED)
 var terminal:OrderCaptureAction?=null;private set
 fun request(action:OrderCaptureAction){if(terminal!=null)return;if(action==OrderCaptureAction.Finish || action==OrderCaptureAction.Cancel)terminal=action;requests.trySend(action)}
 suspend fun awaitAction():OrderCaptureAction=terminal?:requests.receive()
 fun requireFinish(){check(terminal==OrderCaptureAction.Finish){"只有点击完成保存才能提交采集"}}
}

/** Accessibility overlays need no separate draw-over-other-apps permission. */
internal class OrderCaptureOverlay(service:AccessibilityService,val control:OrderCaptureControl,private val images:Boolean=false):AutoCloseable {
 private val manager=service.getSystemService(WindowManager::class.java)
 private val density=service.resources.displayMetrics.density
 private fun dp(value:Int)=(value*density).toInt()
 private val label=TextView(service).apply{setTextColor(Color.WHITE);textSize=14f;setPadding(dp(8),dp(6),dp(8),dp(2))}
 private val next=Button(service).apply{text=if(images)"我来滑" else "下一屏";setOnClickListener{control.request(if(images) OrderCaptureAction.ToggleMode else OrderCaptureAction.Next)}}
 private val view=LinearLayout(service).apply{
  orientation=LinearLayout.VERTICAL;setPadding(dp(8),dp(4),dp(8),dp(4))
  background=GradientDrawable().apply{setColor(Color.rgb(35,38,42));cornerRadius=dp(14).toFloat()}
  addView(label)
  addView(LinearLayout(service).apply{
   orientation=LinearLayout.HORIZONTAL
   addView(next,LinearLayout.LayoutParams(0,dp(48),1f))
   addView(Button(service).apply{text="完成保存";setOnClickListener{control.request(OrderCaptureAction.Finish)}},LinearLayout.LayoutParams(0,dp(48),1.3f))
   addView(Button(service).apply{text="取消";setOnClickListener{control.request(OrderCaptureAction.Cancel)}},LinearLayout.LayoutParams(0,dp(48),.8f))
  })
 }
 init{
  val width=service.resources.displayMetrics.widthPixels-dp(24)
  manager.addView(view,WindowManager.LayoutParams(width,WindowManager.LayoutParams.WRAP_CONTENT,WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,PixelFormat.TRANSLUCENT).apply{gravity=Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL;y=dp(36)})
 }
 fun status(text:String,busy:Boolean=false,nextAllowed:Boolean=true){label.text=text;next.isEnabled=!busy&&nextAllowed}
 fun manual(value:Boolean){if(images)next.text=if(value)"自动滚动" else "我来滑"}
 fun visible(value:Boolean){view.visibility=if(value)View.VISIBLE else View.INVISIBLE}
 override fun close(){if(view.isAttachedToWindow)manager.removeViewImmediate(view)}
}

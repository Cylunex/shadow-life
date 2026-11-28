package com.shadow.life

import android.content.Context

internal object CaptureLocalSettings {
 private fun preferences(context:Context)=context.getSharedPreferences("activity_capture",Context.MODE_PRIVATE)
 fun sync(context:Context,account:String)=preferences(context).getBoolean("capture_sync_$account",true)
 fun canSync(context:Context,app:ShadowApp,account:String)=sync(context,account)&&app.sessions.active()?.accountId==account
 fun setSync(context:Context,account:String,enabled:Boolean){preferences(context).edit().putBoolean("capture_sync_$account",enabled).apply();SyncScheduler.schedule(context,account)}
 val commands=setOf("life.ingest_activity","life.capture_screenshot","life.register_recording","life.restore_activities","life.restore_recording")
}

package com.shadow.life

import android.app.Activity

object SamsungHealthBridge {
  fun available()=BuildConfig.SAMSUNG_HEALTH_DATA_AVAILABLE&&runCatching{Class.forName("com.shadow.life.SamsungSync")}.isSuccess
  fun enable(activity:Activity,accountId:String):Result<Unit> = runCatching{
    check(available()){ "当前安装包未包含 Samsung Health Data SDK" }
    Class.forName("com.shadow.life.SamsungSync").getMethod("enable",Activity::class.java,String::class.java).invoke(null,activity,accountId)
  }
}

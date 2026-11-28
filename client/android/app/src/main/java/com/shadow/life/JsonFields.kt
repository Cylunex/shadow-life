package com.shadow.life

import org.json.JSONObject

internal fun JSONObject.optNullableString(key:String):String?=if(!has(key)||isNull(key))null else optString(key).takeIf(String::isNotBlank)

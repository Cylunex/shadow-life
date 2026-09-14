package com.shadow.life

private val actionableHealthSourceTypes=setOf("health_connect","samsung","scale")

internal fun isActionableHealthSource(sourceType:String):Boolean=sourceType in actionableHealthSourceTypes

internal fun healthSourceNeedsAttention(sourceType:String,permissionState:String,cursorStates:Iterable<String>):Boolean=
  isActionableHealthSource(sourceType)&&(permissionState!="granted"||cursorStates.any{it!="active"})

package com.shadow.life

import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object LifeColors {
  val BackgroundDark=Color(0xFF080A0D);val SurfaceDark=Color(0xFF14171B);val RaisedDark=Color(0xFF20252B);val InputDark=Color(0xFF0F1216)
  val TextDark=Color(0xFFF2F3F5);val SecondaryDark=Color(0xFFA5ABB4);val MutedDark=Color(0xFF9198A2);val OutlineDark=Color(0xFF2D333C)
  val AccentDark=Color(0xFF86D9B4);val OnAccentDark=Color(0xFF0A2B1E);val AccentContainerDark=Color(0xFF19342B)
  val InformationDark=Color(0xFF8DBCF2);val WarmDark=Color(0xFFE8C38B);val ReflectionDark=Color(0xFFBDACEB);val ErrorDark=Color(0xFFEFAA9E)
  val BackgroundLight=Color(0xFFF4F5F7);val SurfaceLight=Color(0xFFFFFFFF);val RaisedLight=Color(0xFFE9EDF0);val InputLight=Color(0xFFF6F7F9)
  val TextLight=Color(0xFF192129);val SecondaryLight=Color(0xFF58636F);val MutedLight=Color(0xFF626D79);val OutlineLight=Color(0xFFD4DBE2)
  val AccentLight=Color(0xFF17694C);val OnAccentLight=Color.White;val AccentContainerLight=Color(0xFFDCEEE5)
  val InformationLight=Color(0xFF32689B);val WarmLight=Color(0xFF885C1A);val ReflectionLight=Color(0xFF70579C);val ErrorLight=Color(0xFFA63426)
}

private val dark=darkColorScheme(primary=LifeColors.AccentDark,onPrimary=LifeColors.OnAccentDark,primaryContainer=LifeColors.AccentContainerDark,onPrimaryContainer=LifeColors.TextDark,secondary=LifeColors.InformationDark,tertiary=LifeColors.WarmDark,background=LifeColors.BackgroundDark,onBackground=LifeColors.TextDark,surface=LifeColors.SurfaceDark,onSurface=LifeColors.TextDark,surfaceVariant=LifeColors.RaisedDark,onSurfaceVariant=LifeColors.SecondaryDark,outline=LifeColors.OutlineDark,error=LifeColors.ErrorDark)
private val light=lightColorScheme(primary=LifeColors.AccentLight,onPrimary=LifeColors.OnAccentLight,primaryContainer=LifeColors.AccentContainerLight,onPrimaryContainer=LifeColors.TextLight,secondary=LifeColors.InformationLight,tertiary=LifeColors.WarmLight,background=LifeColors.BackgroundLight,onBackground=LifeColors.TextLight,surface=LifeColors.SurfaceLight,onSurface=LifeColors.TextLight,surfaceVariant=LifeColors.RaisedLight,onSurfaceVariant=LifeColors.SecondaryLight,outline=LifeColors.OutlineLight,error=LifeColors.ErrorLight)
private val typography=Typography(
  headlineLarge=TextStyle(fontSize=30.sp,lineHeight=38.sp,fontWeight=FontWeight.SemiBold),
  headlineMedium=TextStyle(fontSize=24.sp,lineHeight=32.sp,fontWeight=FontWeight.SemiBold),
  titleLarge=TextStyle(fontSize=18.sp,lineHeight=26.sp,fontWeight=FontWeight.SemiBold),
  titleMedium=TextStyle(fontSize=16.sp,lineHeight=24.sp,fontWeight=FontWeight.Medium),
  bodyLarge=TextStyle(fontSize=16.sp,lineHeight=24.sp),bodyMedium=TextStyle(fontSize=14.sp,lineHeight=20.sp),labelLarge=TextStyle(fontSize=14.sp,lineHeight=20.sp,fontWeight=FontWeight.Medium),labelMedium=TextStyle(fontSize=12.sp,lineHeight=16.sp)
)

class AppearanceStore(context:Context){
  private val preferences=context.getSharedPreferences("life_appearance",Context.MODE_PRIVATE)
  fun current():Appearance=runCatching{Appearance.valueOf(preferences.getString("appearance",null)?:Appearance.Dark.name)}.getOrDefault(Appearance.Dark)
  fun save(value:Appearance){preferences.edit().putString("appearance",value.name).apply()}
}

@Composable fun LifeTheme(appearance:Appearance,content:@Composable ()->Unit){
  val useDark=appearance==Appearance.Dark||(appearance==Appearance.System&&isSystemInDarkTheme())
  MaterialTheme(colorScheme=if(useDark)dark else light,typography=typography,content=content)
}

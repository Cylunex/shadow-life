package com.shadow.life

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

// Small native vectors keep the service identities clear without an icon-font dependency.
internal object LifeModuleIcons {
  private fun outline(name:String,draw:PathBuilder.()->Unit)=ImageVector.Builder(name,24.dp,24.dp,24f,24f).apply{
    path(fill=null,stroke=SolidColor(Color.Black),strokeLineWidth=1.8f,strokeLineCap=StrokeCap.Round,strokeLineJoin=StrokeJoin.Round,pathBuilder=draw)
  }.build()
  val Wallet=outline("LifeWallet"){
    moveTo(20f,7f);lineTo(5f,7f);curveTo(2f,7f,2f,3f,5f,3f);lineTo(18f,3f);lineTo(18f,7f)
    moveTo(3f,5f);lineTo(3f,19f);lineTo(21f,19f);lineTo(21f,7f);lineTo(20f,7f)
    moveTo(21f,11f);lineTo(15f,11f);lineTo(15f,15f);lineTo(21f,15f)
  }
  val Meals=outline("LifeMeals"){
    moveTo(4f,3f);lineTo(4f,8f);quadTo(4f,10f,7f,10f);quadTo(10f,10f,10f,8f);lineTo(10f,3f)
    moveTo(7f,3f);lineTo(7f,21f)
    moveTo(20f,21f);lineTo(20f,3f);quadTo(15f,5f,15f,12f);lineTo(20f,12f)
  }
  val Services=outline("LifeServices"){
    moveTo(3f,3f);lineTo(9f,3f);lineTo(9f,9f);lineTo(3f,9f);close()
    moveTo(15f,3f);lineTo(21f,3f);lineTo(21f,9f);lineTo(15f,9f);close()
    moveTo(3f,15f);lineTo(9f,15f);lineTo(9f,21f);lineTo(3f,21f);close()
    moveTo(15f,15f);lineTo(21f,15f);lineTo(21f,21f);lineTo(15f,21f);close()
  }
  val Statistics=outline("LifeStatistics"){
    moveTo(5f,20f);lineTo(5f,12f);moveTo(12f,20f);lineTo(12f,4f);moveTo(19f,20f);lineTo(19f,8f)
  }
  val Sleep=outline("LifeSleep"){
    moveTo(20f,15f);curveTo(10f,18f,6f,9f,10f,3f);curveTo(-1f,6f,2f,22f,13f,21f);quadTo(18f,21f,20f,15f);close()
  }
  val Training=outline("LifeTraining"){
    moveTo(7f,5f);lineTo(7f,19f);moveTo(3f,8f);lineTo(3f,16f)
    moveTo(17f,5f);lineTo(17f,19f);moveTo(21f,8f);lineTo(21f,16f)
    moveTo(3f,12f);lineTo(21f,12f)
  }
}

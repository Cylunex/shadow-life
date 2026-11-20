package com.shadow.life

import android.media.MediaDataSource
import android.media.MediaPlayer
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

internal fun pcmWavePeaks(bytes:ByteArray):List<Float>{
  if(bytes.size<44)return emptyList()
  val wave=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
  fun label(at:Int)=String(bytes,at,4,Charsets.US_ASCII)
  if(label(0)!="RIFF"||label(8)!="WAVE")return emptyList()
  var offset=12
  var frameSize=0
  while(offset<=bytes.size-8){
    val type=label(offset)
    val length=wave.getInt(offset+4)
    val start=offset+8
    if(length<0||length>bytes.size-start)return emptyList()
    when(type){
      "fmt "->{
        if(length<16||wave.getShort(start).toInt()!=1||wave.getShort(start+14).toInt()!=16)return emptyList()
        val channels=wave.getShort(start+2).toInt()
        if(channels !in 1..8||wave.getShort(start+12).toInt()!=channels*2)return emptyList()
        frameSize=channels*2
      }
      "data"->{
        if(frameSize==0||length<frameSize)return emptyList()
        val frames=length/frameSize
        val columns=minOf(80,frames)
        val peaks=FloatArray(columns)
        for(frame in 0 until frames){
          val bin=(frame.toLong()*columns/frames).toInt()
          val at=start+frame*frameSize
          for(channel in 0 until frameSize step 2){
            peaks[bin]=maxOf(peaks[bin],abs(wave.getShort(at+channel).toInt())/32768f)
          }
        }
        return peaks.toList()
      }
    }
    offset=start+length+(length%2)
  }
  return emptyList()
}

internal class RecordingPlayback{
  var id by mutableStateOf<String?>(null);private set
  var prepared by mutableStateOf(false);private set
  var duration by mutableIntStateOf(0);private set
  var position by mutableIntStateOf(0);private set
  var isPlaying by mutableStateOf(false);private set
  var peaks by mutableStateOf<List<Float>>(emptyList());private set
  private var player:MediaPlayer?=null
  private var closed=false

  fun start(recordingId:String,bytes:ByteArray,amplitude:List<Float>,at:Int,onError:()->Unit){
    if(closed){bytes.fill(0);return}
    stop()
    val next=MediaPlayer()
    val source=object:MediaDataSource(){
      override fun getSize()=bytes.size.toLong()
      override fun readAt(position:Long,buffer:ByteArray,offset:Int,size:Int):Int{
        if(position<0||position>=bytes.size)return -1
        val count=minOf(size,bytes.size-position.toInt())
        bytes.copyInto(buffer,offset,position.toInt(),position.toInt()+count)
        return count
      }
      override fun close(){bytes.fill(0)}
    }
    try{
      player=next;id=recordingId;peaks=amplitude
      next.setDataSource(source)
      next.setOnPreparedListener{
        if(player!==it)return@setOnPreparedListener
        duration=it.duration.coerceAtLeast(0)
        prepared=true;seek(at,true)
      }
      next.setOnCompletionListener{if(player===it){isPlaying=false;position=duration}}
      next.setOnErrorListener{failed,_,_->if(player===failed){stop();onError()};true}
      next.prepareAsync()
    }catch(error:Exception){stop();source.close();throw error}
  }

  fun update(){
    if(prepared)player?.let{position=it.currentPosition.coerceIn(0,duration);isPlaying=it.isPlaying}
  }

  fun seek(value:Int,resume:Boolean=false){
    if(!prepared)return
    val target=value.coerceIn(0,duration)
    player?.let{active->
      active.seekTo(target.toLong(),MediaPlayer.SEEK_CLOSEST);position=target
      if(resume){active.start();isPlaying=true}
    }
  }

  fun toggle(){
    if(!prepared)return
    player?.let{active->
      if(active.isPlaying){active.pause();isPlaying=false}
      else{if(position==duration)active.seekTo(0);active.start();isPlaying=true}
    }
  }

  fun stop(){
    val old=player;player=null;prepared=false;id=null;isPlaying=false;duration=0;position=0;peaks=emptyList()
    old?.release()
  }

  fun close(){closed=true;stop()}
}

internal fun recordingTimestamp(ms:Int):String{
  val seconds=ms/1000
  return "${seconds/60}:${(seconds%60).toString().padStart(2,'0')}"
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun RecordingPlaybackControls(playback:RecordingPlayback,maxClipMs:Int,busy:Boolean,onClip:(Int,Int,()->Unit)->Unit){
  if(!playback.prepared){Text("正在准备播放",style=MaterialTheme.typography.bodySmall);return}
  var drag by remember(playback.id){mutableStateOf<Float?>(null)}
  var selecting by remember(playback.id){mutableStateOf(false)}
  var clipStart by remember(playback.id){mutableIntStateOf(0)}
  var clipEnd by remember(playback.id){mutableIntStateOf(0)}
  val selected=drag?:(playback.position.toFloat())
  val clipLimit=minOf(playback.duration,maxClipMs)
  val clipPosition=selected.toInt().coerceIn(0,clipLimit.coerceAtLeast(0))
  fun precise(ms:Int)="${recordingTimestamp(ms)}.${(ms%1000).toString().padStart(3,'0')}"
  val remaining=MaterialTheme.colorScheme.outline
  val elapsed=MaterialTheme.colorScheme.primary
  val peaks=playback.peaks
  if(peaks.isNotEmpty())Canvas(Modifier.fillMaxWidth().height(52.dp).semantics{contentDescription="录音波形"}){
    val step=size.width/peaks.size
    peaks.forEachIndexed{index,value->
      val x=(index+.5f)*step
      val height=(value*size.height*.48f).coerceAtLeast(1.dp.toPx())
      val color=if(selected>=playback.duration*index.toFloat()/peaks.size)elapsed else remaining
      drawLine(color,Offset(x,size.height/2-height),Offset(x,size.height/2+height),(step*.55f).coerceAtLeast(1f))
    }
  }
  Slider(value=selected,onValueChange={drag=it},onValueChangeFinished={drag?.let{playback.seek(it.toInt())};drag=null},
    valueRange=0f..maxOf(1,playback.duration).toFloat(),modifier=Modifier.semantics{contentDescription="定位录音时间"})
  Text("${recordingTimestamp(selected.toInt())} / ${recordingTimestamp(playback.duration)}",
    style=MaterialTheme.typography.labelMedium)
  Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
    TextButton(onClick=playback::toggle){Text(if(playback.isPlaying)"暂停播放" else "继续播放")}
    TextButton(onClick=playback::stop){Text("停止播放")}
  }
  if(clipLimit>0)TextButton(onClick={
    if(!selecting){clipStart=clipPosition;clipEnd=clipLimit}
    selecting=!selecting
  }){Text(if(selecting)"取消选段" else "选取片段")}
  if(selecting){
    Text("${precise(clipStart)} — ${precise(clipEnd)}",style=MaterialTheme.typography.labelMedium)
    FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
      TextButton(onClick={clipStart=clipPosition}){Text("当前位置设为起点")}
      TextButton(onClick={clipEnd=clipPosition}){Text("当前位置设为终点")}
    }
    Button(enabled=!busy&&clipStart<clipEnd,onClick={onClip(clipStart,clipEnd){selecting=false}}){Text("保存精选片段")}
  }
}

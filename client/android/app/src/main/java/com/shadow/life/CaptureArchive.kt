package com.shadow.life

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.json.*
import java.io.*
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.*
import java.time.Instant

private const val ARCHIVE_LIMIT=4L*1024*1024*1024
private val archiveJson=Json{encodeDefaults=true}
private fun digest(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
private fun checkedSession(app:ShadowApp,account:String)=app.sessions.active()?.takeIf{it.accountId==account}?:error("账号已切换，导出／恢复已停止")
internal suspend fun exportCaptureArchive(context:Context,app:ShadowApp,repository:NativeLifeRepository,account:String,uri:Uri,from:String,to:String,originals:Boolean):String=withContext(Dispatchers.IO){
 checkedSession(app,account);val archiveId="archive_"+UUID.randomUUID().toString().replace("-","");val assets=linkedMapOf<String,JSONObject>();val itemsHash=MessageDigest.getInstance("SHA-256");var count=0;var total=0L
 context.contentResolver.openOutputStream(uri,"w")!!.use{output->ZipOutputStream(output).use{zip->
  zip.putNextEntry(ZipEntry("items.jsonl"));var cursor:String?=null
  do{checkedSession(app,account);val page=repository.captureExport(from,to,cursor);for(item in page.items){check(++count<=10000){"来源超过 10000 项，请缩小导出范围"};val bytes=(archiveJson.encodeToString(item)+"\n").toByteArray();zip.write(bytes);itemsHash.update(bytes);total+=bytes.size;check(total<ARCHIVE_LIMIT);if(originals)for(asset in item.originals)assets.putIfAbsent(asset.assetVersionId,JSONObject().put("asset_version_id",asset.assetVersionId).put("sha256",asset.sha256).put("media_type",asset.mediaType).put("bytes",asset.bytes).put("path","assets/${asset.assetVersionId}.bin"))};cursor=page.nextBeforeId}while(cursor!=null)
  zip.closeEntry()
  for((id,metadata) in assets){checkedSession(app,account);val bytes=repository.assetPreview(id);check(digest(bytes)==metadata.getString("sha256")){"原件校验失败，请重试"};check(bytes.size.toLong()==metadata.getLong("bytes"));total+=bytes.size;check(total<=ARCHIVE_LIMIT){"原件超过 4 GB，请缩小范围"};zip.putNextEntry(ZipEntry(metadata.getString("path")));zip.write(bytes);zip.closeEntry()}
  checkedSession(app,account);val manifest=JSONObject().put("schema_version",1).put("archive_id",archiveId).put("from_on",from).put("to_on_exclusive",to).put("items_count",count).put("items_sha256",itemsHash.digest().joinToString(""){"%02x".format(it)}).put("originals",JSONArray(assets.values.toList())).put("complete",true)
  zip.putNextEntry(ZipEntry("manifest.json"));zip.write(manifest.toString().toByteArray());zip.closeEntry()
 }}
 "已导出 $count 项来源、${assets.size} 份原件；保存到你选择的位置。"
}
private suspend fun lines(input:InputStream,hash:MessageDigest?=null,block:suspend (JSONObject)->Unit):Int{
 val buffer=ByteArray(8192);val line=ByteArrayOutputStream();var total=0L;var count=0
 while(true){currentCoroutineContext().ensureActive();val size=input.read(buffer);if(size<0)break;total+=size;check(total<=128L*1024*1024){"材料正文超过限制"};hash?.update(buffer,0,size);var offset=0
  for(index in 0 until size)if(buffer[index]==10.toByte()){line.write(buffer,offset,index-offset);check(line.size()<=4_000_000);if(line.size()>0){block(JSONObject(line.toString("UTF-8")));check(++count<=10000)};line.reset();offset=index+1}
  line.write(buffer,offset,size-offset);check(line.size()<=4_000_000){"单项材料超过限制"}
 }
 check(line.size()==0){"材料文件尾部不完整"};return count
}
private fun limited(input:InputStream,max:Int):ByteArray {val out=ByteArrayOutputStream();val bytes=ByteArray(8192);while(true){val n=input.read(bytes);if(n<0)break;check(out.size()+n<=max){"原件超过限制"};out.write(bytes,0,n)};return out.toByteArray()}
private suspend fun <T> readStaged(file:File,session:ProductSession,id:String,block:suspend (ZipInputStream)->T):T{
 QueueCrypto().openAttachmentInput(PendingAttachment(id,session.accountId,session.subjectId,"cmd_$id",file.path,"application/zip",encryptionVersion=1),file.inputStream()).use{input->ZipInputStream(input).use{zip->val value=block(zip);val buffer=ByteArray(8192);while(input.read(buffer)>=0){};return value}}
}
internal suspend fun restoreCaptureArchive(context:Context,app:ShadowApp,repository:NativeLifeRepository,account:String,uri:Uri):String=withContext(Dispatchers.IO){
 val session=checkedSession(app,account);val id="restore_stage_"+UUID.randomUUID().toString().replace("-","");val stage=File(context.filesDir,"capture-restore/$id.enc");stage.parentFile!!.mkdirs()
 try{
  context.contentResolver.openInputStream(uri)!!.use{raw->val capped=object:FilterInputStream(raw){var total=0L;override fun read(b:ByteArray,off:Int,len:Int):Int{val n=super.read(b,off,len);if(n>0){total+=n;check(total<=ARCHIVE_LIMIT){"导出包超过 4 GB"}};return n}};QueueCrypto().encryptAttachment(account,session.subjectId,id,capped,stage.outputStream())}
  var manifest:JSONObject?=null;val hash=MessageDigest.getInstance("SHA-256");val seen=linkedSetOf<String>();val observed=linkedMapOf<String,Pair<String,Long>>();val attachments=linkedMapOf<String,MutableList<JSONObject>>();var count=0
  readStaged(stage,session,id){zip->while(true){val entry=zip.nextEntry?:break;check(seen.size<10002);check(seen.add(entry.name)){"导出包存在重复条目"};check(!entry.isDirectory);when{
   entry.name=="items.jsonl"->count=lines(zip,hash){item->check(item.getString("id").matches(Regex("[A-Za-z][A-Za-z0-9_-]{0,119}")));check(item.getString("kind") in listOf("app_usage","manual","screen_text","stay","recording"));val originals=item.optJSONArray("originals")?:JSONArray();for(i in 0 until originals.length()){val version=originals.getJSONObject(i).getString("asset_version_id");attachments.getOrPut(version){mutableListOf()}.add(JSONObject().apply{for(key in listOf("id","title","kind","started_at","ended_at","time_zone","recording","behavior","life_domain","project_id","protected"))if(item.has(key))put(key,item.get(key))})}}
   entry.name=="manifest.json"->manifest=JSONObject(String(limited(zip,1_000_000),Charsets.UTF_8))
   entry.name.matches(Regex("assets/[a-z0-9_]{8,128}\\.bin"))->{val bytes=limited(zip,10_000_000);observed[entry.name]=digest(bytes) to bytes.size.toLong();check(observed.values.sumOf{it.second}<=ARCHIVE_LIMIT)}
   else->error("导出包包含未知条目")
  };zip.closeEntry()}}
  val metadata=manifest?:error("导出包缺少完成清单");check(metadata.getInt("schema_version")==1&&metadata.getBoolean("complete"));val archiveId=metadata.getString("archive_id");check(archiveId.matches(Regex("[a-z0-9_]{8,80}")));check(count==metadata.getInt("items_count"));check(hash.digest().joinToString(""){"%02x".format(it)}==metadata.getString("items_sha256")){"材料校验不一致"}
  val originals=metadata.getJSONArray("originals");check(originals.length()==observed.size);val originalMap=linkedMapOf<String,JSONObject>();for(i in 0 until originals.length()){val original=originals.getJSONObject(i);val actual=observed[original.getString("path")]?:error("导出包缺少原件");check(actual.first==original.getString("sha256")&&actual.second==original.getLong("bytes")){"原件校验失败"};originalMap[original.getString("path")]=original}
  checkedSession(app,account);var restored=0;var restoredFiles=0;val batch=JSONArray();val classifications=JSONArray()
  suspend fun flush(){if(batch.length()==0)return;checkedSession(app,account);repository.captureWrite("life.restore_activities",JSONObject().put("archive_id",archiveId).put("items",JSONArray(batch.toString())).put("classifications",JSONArray(classifications.toString())),account);restored+=batch.length();while(batch.length()>0)batch.remove(0);while(classifications.length()>0)classifications.remove(0)}
  // The validated encrypted snapshot is stable across both passes; enqueue only after full validation.
  readStaged(stage,session,id){zip->while(true){val entry=zip.nextEntry?:break;if(entry.name=="items.jsonl")lines(zip){item->val recording=item.optString("recording").takeIf{it.isNotBlank()&&it!="null"}?.let{JSONObject(it)};val hasAudio=recording!=null&&originalMap.values.any{it.getString("asset_version_id")==recording.getString("asset_version_id")};if(hasAudio)return@lines
   val input=JSONObject().put("source_id",item.getString("id"));for(key in listOf("kind","title","started_at","ended_at","time_zone","app_package","text","latitude","longitude","accuracy_m"))if(item.has(key)&&!item.isNull(key))input.put(key,item.get(key));batch.put(input);classifications.put(JSONObject().put("source_id",item.getString("id")).put("behavior",item.optString("behavior","unknown")).put("life_domain",item.optString("life_domain","unknown")).put("project_id",item.opt("project_id")?:JSONObject.NULL).put("protected",item.optBoolean("protected")));if(batch.length()==100)flush()

  };zip.closeEntry()}};flush()
  // Each original is bounded to 10 MB. Repeated file content can back several independently timed captures.
  readStaged(stage,session,id){zip->while(true){val entry=zip.nextEntry?:break;val original=originalMap[entry.name]
   if(original!=null){val bytes=limited(zip,10_000_000);checkedSession(app,account);for(item in attachments[original.getString("asset_version_id")].orEmpty()){
   val recording=item.optString("recording").takeIf{it.isNotBlank()&&it!="null"}?.let{JSONObject(it)};val key=digest((account+archiveId+item.getString("id")+original.getString("asset_version_id")).toByteArray()).take(40);val attachmentId="restore_$key"
   val input:JSONObject;val capability:String
   if(recording!=null){capability="life.restore_recording";input=JSONObject().put("segment_id","audio_restore_$key").put("session_id","recording_restore_"+digest((account+archiveId+recording.getString("session_id")).toByteArray()).take(40)).put("segment_index",recording.getInt("segment_index")).put("spans",recording.getJSONArray("spans"));for(field in listOf("title","started_at","ended_at","time_zone"))input.put(field,recording.get(field));input.put("classification",JSONObject().put("behavior",item.optString("behavior","unknown")).put("life_domain",item.optString("life_domain","unknown")).put("project_id",item.opt("project_id")?:JSONObject.NULL).put("protected",item.optBoolean("protected")))}
   else{if(!original.getString("media_type").startsWith("image/"))continue;capability="life.restore_screenshot";input=JSONObject().put("archive_id",archiveId).put("source_id",item.getString("id")).put("title",item.getString("title")).put("captured_at",item.getString("started_at")).put("time_zone",item.getString("time_zone"))}
   val envelope=JSONObject().put("capability",capability).put("input",input);app.queue.enqueueAttachment(session,attachmentId,"cmd_$attachmentId",original.getString("media_type"),item.getString("started_at").take(10),item.getString("title"),bytes.inputStream(),File(context.filesDir,"attachments/$attachmentId.enc"),envelope.toString());restoredFiles++
   }};zip.closeEntry()}}
  SyncScheduler.schedule(context,account);"已将 $restored 项材料和 $restoredFiles 份原件恢复请求加入加密队列；原始付款与系统权限不会随导出包恢复。"
 }finally{stage.delete()}
}

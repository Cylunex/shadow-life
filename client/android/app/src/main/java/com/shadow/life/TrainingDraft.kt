package com.shadow.life

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable internal data class TrainingSetDraft(val value:String="",val load:String="",val completed:Boolean=false)
@Serializable internal data class TrainingExerciseDraft(val id:String,val snapshot:String,val sets:List<TrainingSetDraft> = listOf(TrainingSetDraft()))
@Serializable internal data class TrainingDraft(
  val date:String,val timeZone:String,val focus:String="chest",val planId:String="",
  val started:Boolean=false,val exercises:List<TrainingExerciseDraft> = emptyList(),val restUntil:Long=0,val commandId:String="",val submission:String=""
){
  val completedSets:Int get()=exercises.sumOf{exercise->exercise.sets.count{it.completed}}
}

internal fun validTrainingSet(set:TrainingSetDraft,unit:String,dumbbell:Boolean):Boolean =
  set.value.toIntOrNull()?.let{it in 1..(if(unit=="reps")1000 else 7200)}==true &&
    (!dumbbell||set.load.isBlank()||Regex("(?:0|[1-9]\\d{0,2})(?:\\.\\d{1,3})?").matches(set.load.trim()))

internal fun trainingRestSeconds(deadline:Long,now:Long):Long = ((deadline-now+999)/1000).coerceAtLeast(0)

/** A local draft is account-scoped and encrypted, and never a completed workout. */
internal class TrainingDraftStore(context:Context,private val accountId:String){
  private val preferences=EncryptedSharedPreferences.create(context,"shadow-life-training-drafts",
    MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
  fun read():TrainingDraft?=runCatching{
    val raw=preferences.getString(accountId,null)?:return null
    Json.decodeFromString<TrainingDraft>(raw).also{draft->
      require(draft.exercises.size<=30&&draft.exercises.all{it.sets.size in 1..30})
      java.time.LocalDate.parse(draft.date);java.time.ZoneId.of(draft.timeZone)
    }
  }.getOrNull()
  fun save(draft:TrainingDraft):Boolean {
    val editor=preferences.edit().apply{if(draft.exercises.isEmpty())remove(accountId) else putString(accountId,Json.encodeToString(draft))}
    // Freeze the retry key durably before the command can enter the offline queue.
    return if(draft.commandId.isNotBlank())editor.commit() else {editor.apply();true}
  }
}

package com.shadow.life
import androidx.room.*
import kotlinx.coroutines.flow.Flow
@Entity(tableName="pending_commands",indices=[Index(value=["accountId","subjectId","commandId"],unique=true)]) data class PendingCommand(@PrimaryKey val commandId:String,val accountId:String,val subjectId:String,val capability:String,val body:String,val state:String="pending",val attempts:Int=0,val createdAt:Long=System.currentTimeMillis(),@ColumnInfo(defaultValue="0")val encryptionVersion:Int=0,@ColumnInfo(defaultValue="''")val receiptBody:String="")
@Entity(tableName="pending_attachments",indices=[Index(value=["accountId","subjectId","commandId"],unique=true)]) data class PendingAttachment(@PrimaryKey val id:String,val accountId:String,val subjectId:String,val commandId:String,val localPath:String,val mediaType:String,val state:String="pending",@ColumnInfo(defaultValue="0")val attempts:Int=0,val createdAt:Long=System.currentTimeMillis(),@ColumnInfo(defaultValue="0")val encryptionVersion:Int=0,@ColumnInfo(defaultValue="''")val capturedOn:String="")
@Entity(tableName="health_sync_rounds",primaryKeys=["accountId","subjectId"])
data class HealthSyncRoundRow(val accountId:String,val subjectId:String,@Embedded val progress:HealthRoundState)
@Dao interface CommandDao{
  @Query("select * from health_sync_rounds where accountId=:account and subjectId=:subject")suspend fun healthRound(account:String,subject:String):HealthSyncRoundRow?
  @Insert(onConflict=OnConflictStrategy.REPLACE)suspend fun saveHealthRound(value:HealthSyncRoundRow)
  @Transaction suspend fun confirmHealthRound(account:String,subject:String,commandId:String){
    val row=healthRound(account,subject)?:return
    val next=row.progress.confirmed(commandId)
    if(next!=row.progress)saveHealthRound(row.copy(progress=next))
  }
  @Transaction suspend fun commitWithHealthRound(command:PendingCommand,receipt:String){
    commitCommand(command.commandId,receipt)
    confirmHealthRound(command.accountId,command.subjectId,command.commandId)
  }
  @Insert(onConflict=OnConflictStrategy.IGNORE)suspend fun enqueue(value:PendingCommand):Long
  @Query("select * from pending_commands where commandId=:id")suspend fun command(id:String):PendingCommand?
  @Query("select * from pending_commands where accountId=:account and subjectId=:subject and state in ('pending','uploading','unknown') and encryptionVersion=1 order by createdAt")suspend fun pending(account:String,subject:String):List<PendingCommand>
  @Query("select count(*) from pending_commands where accountId=:account and subjectId=:subject and capability=:capability and state in ('pending','uploading','unknown')")suspend fun inFlight(account:String,subject:String,capability:String):Int
  @Query("select * from pending_commands where accountId=:account and subjectId=:subject order by createdAt desc")fun observe(account:String,subject:String):Flow<List<PendingCommand>>
  @Query("select (select count(*) from pending_commands where accountId='' and state='needs_account')+(select count(*) from pending_attachments where accountId='' and state='needs_account')")fun observeRecoverableCount():Flow<Int>
  @Query("update pending_commands set accountId=:account,subjectId=:subject,state='needs_encryption' where accountId='' and state='needs_account'")suspend fun recoverCommandsToAccount(account:String,subject:String):Int
  @Query("update pending_attachments set accountId=:account,subjectId=:subject,state='needs_encryption' where accountId='' and state='needs_account'")suspend fun recoverAttachmentsToAccount(account:String,subject:String):Int
  @Transaction suspend fun recoverToAccount(account:String,subject:String)=recoverCommandsToAccount(account,subject)+recoverAttachmentsToAccount(account,subject)
  @Query("select * from pending_commands where accountId=:account and subjectId=:subject and encryptionVersion=0")suspend fun legacyCommands(account:String,subject:String):List<PendingCommand>
  @Query("update pending_commands set body=:body,encryptionVersion=1,state='pending' where commandId=:id")suspend fun secureCommand(id:String,body:String)
  @Query("update pending_commands set state=:state,attempts=attempts+1 where commandId=:id")suspend fun mark(id:String,state:String)
  @Query("update pending_commands set state=:state where commandId=:id")suspend fun setCommandState(id:String,state:String)
  @Query("update pending_commands set state='committed',receiptBody=:receipt where commandId=:id")suspend fun commitCommand(id:String,receipt:String)
  @Query("update pending_commands set state='unknown',attempts=0 where accountId=:account and subjectId=:subject and state in ('blocked','failed') and encryptionVersion=1")suspend fun retryCommands(account:String,subject:String):Int
  @Query("delete from pending_commands where accountId=:account and subjectId=:subject and state in ('committed','blocked','failed') and commandId not in (select waitingCommandId from health_sync_rounds where waitingCommandId is not null)")suspend fun clearTerminalCommands(account:String,subject:String):Int
  @Insert(onConflict=OnConflictStrategy.IGNORE)suspend fun enqueueAttachment(value:PendingAttachment):Long
  @Query("select * from pending_attachments where id=:id")suspend fun attachment(id:String):PendingAttachment?
  @Query("select * from pending_attachments where accountId=:account and subjectId=:subject and state in ('pending','uploading','unknown') and encryptionVersion=1 order by createdAt")suspend fun pendingAttachments(account:String,subject:String):List<PendingAttachment>
  @Query("select * from pending_attachments where accountId=:account and subjectId=:subject order by createdAt desc")fun observeAttachments(account:String,subject:String):Flow<List<PendingAttachment>>
  @Query("select * from pending_attachments where accountId=:account and subjectId=:subject and encryptionVersion=0")suspend fun legacyAttachments(account:String,subject:String):List<PendingAttachment>
  @Query("update pending_attachments set encryptionVersion=1,state='pending' where id=:id")suspend fun secureAttachment(id:String)
  @Query("update pending_attachments set state=:state where id=:id")suspend fun markAttachment(id:String,state:String)
  @Query("update pending_attachments set state=:state,attempts=attempts+1 where id=:id")suspend fun markAttachmentAttempt(id:String,state:String)
  @Query("update pending_attachments set state='pending',attempts=0 where accountId=:account and subjectId=:subject and state in ('blocked','failed') and encryptionVersion=1")suspend fun retryAttachments(account:String,subject:String):Int
  @Query("select * from pending_attachments where accountId=:account and subjectId=:subject and state in ('committed','blocked','failed')")suspend fun terminalAttachments(account:String,subject:String):List<PendingAttachment>
  @Query("delete from pending_attachments where id=:id and state in ('committed','blocked','failed')")suspend fun clearTerminalAttachment(id:String):Int
}
@Database(entities=[PendingCommand::class,PendingAttachment::class,HealthSyncRoundRow::class],version=6,exportSchema=true)abstract class ShadowDatabase:RoomDatabase(){abstract fun commands():CommandDao}

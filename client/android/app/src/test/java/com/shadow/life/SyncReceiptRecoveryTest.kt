package com.shadow.life

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [34])
class SyncReceiptRecoveryTest {
  private val command = PendingCommand("cmd_samsung_fixture", "account", "subject", "health.ingest_raw", "encrypted", encryptionVersion = 1)
  private val receipt = """
    {"protocol":"shadow.execution-result","status":"committed","command_id":"cmd_samsung_fixture","capability":"health.ingest_raw","execution_id":"exec_fixture"}
  """.trimIndent()

  @Test fun `only a matching committed receipt resolves a command`() {
    assertEquals(ReceiptLookup.Verified(receipt), classifyReceiptLookup(200, receipt, command))
    assertEquals(ReceiptLookup.Deferred, classifyReceiptLookup(200, receipt.replace("cmd_samsung_fixture", "cmd_other"), command))
    assertEquals(ReceiptLookup.Deferred, classifyReceiptLookup(200, receipt.replace("health.ingest_raw", "money.record"), command))
  }

  @Test fun `only the Life not found response allows the same command to be sent`() {
    val missing = """{"protocol":"shadow.error","code":"not_found"}"""
    assertEquals(ReceiptLookup.Missing, classifyReceiptLookup(404, missing, command))
    assertEquals(ReceiptLookup.Deferred, classifyReceiptLookup(404, "<html>Not found</html>", command))
    assertEquals(ReceiptLookup.Deferred, classifyReceiptLookup(503, missing, command))
    assertEquals(ReceiptLookup.ReauthRequired, classifyReceiptLookup(401, "", command))
  }

  @Test fun `uploading and unknown commands are excluded from uploads until reconciled`() = runBlocking {
    val database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), ShadowDatabase::class.java).build()
    try {
      val dao = database.commands()
      dao.enqueue(command.copy(commandId = "new", createdAt = 1))
      dao.enqueue(command.copy(commandId = "unknown", state = "unknown", attempts = 3, createdAt = 2))
      dao.enqueue(command.copy(commandId = "interrupted", state = "uploading", createdAt = 3))
      dao.enqueue(command.copy(commandId = "paused-capture", state = "unknown", capability = "life.ingest_activity"))
      dao.enqueue(command.copy(commandId = "other-account", state = "unknown", accountId = "other"))

      assertEquals(listOf("new"), dao.readyCommands("account", "subject", false, 10).map { it.commandId })
      assertEquals(listOf("unknown", "interrupted"), dao.commandsAwaitingReceipt("account", "subject", false, 10).map { it.commandId })
      assertEquals(3, dao.commandsAwaitingReceipt("account", "subject", true, 10).size)

      dao.setCommandState("unknown", "pending")
      dao.commitCommand("interrupted", "encrypted receipt")
      val ready = dao.readyCommands("account", "subject", false, 10)
      assertEquals(listOf("new", "unknown"), ready.map { it.commandId })
      assertEquals(3, ready.last().attempts)
      assertEquals("encrypted", ready.last().body)
      assertEquals(emptyList<PendingCommand>(), dao.commandsAwaitingReceipt("account", "subject", false, 10))
    } finally {
      database.close()
    }
  }
}

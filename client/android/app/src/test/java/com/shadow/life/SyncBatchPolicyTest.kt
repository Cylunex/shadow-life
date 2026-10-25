package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncBatchPolicyTest {
  private fun command(id:String,bodySize:Int=20)=PendingCommand(id,"account","subject","health.ingest_raw","encrypted") to "x".repeat(bodySize)

  @Test fun `deterministic client errors do not enter receipt reconciliation`() {
    listOf(400,403,409,413,415,422).forEach{assertTrue(isDeterministicCommandFailure(it))}
    listOf(401,404,429,500,503).forEach{assertFalse(isDeterministicCommandFailure(it))}
  }

  @Test fun `health commands are packed by command count`() {
    val batches=healthCommandBatches((1..25).map{command("cmd_$it")})
    assertEquals(listOf(12,12,1),batches.map{it.size})
  }

  @Test fun `health commands are packed below request byte limit`() {
    val batches=healthCommandBatches(listOf(command("cmd_1",60),command("cmd_2",60),command("cmd_3",20)),maxCommands=40,maxBytes=100)
    assertEquals(listOf(listOf("cmd_1"),listOf("cmd_2","cmd_3")),batches.map{batch->batch.map{it.first.commandId}})
  }
}

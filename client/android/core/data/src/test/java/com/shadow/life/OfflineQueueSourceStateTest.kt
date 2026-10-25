package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OfflineQueueSourceStateTest {
  @Test fun latestCommandWinsOverAnOlderFailure(){
    val commands=listOf(command("cmd_scale_old","failed",100),command("cmd_scale_new","committed",200))
    assertEquals("committed",latestSourceState(commands))
  }

  @Test fun uploadStatesUseUserFacingQueuePhases(){
    assertEquals("pending",latestSourceState(listOf(command("pending","uploading",100))))
    assertEquals("reconciling",latestSourceState(listOf(command("unknown","unknown",100))))
    assertEquals("failed",latestSourceState(listOf(command("blocked","blocked",100))))
    assertNull(latestSourceState(emptyList()))
  }

  @Test fun equalTimestampsHaveDeterministicCommandOrder(){
    val commands=listOf(command("cmd_scale_a","failed",100),command("cmd_scale_b","pending",100))
    assertEquals("pending",latestSourceState(commands))
  }

  private fun command(id:String,state:String,createdAt:Long)=PendingCommand(id,"account","subject","health.ingest_raw","encrypted",state=state,createdAt=createdAt,encryptionVersion=1)
}

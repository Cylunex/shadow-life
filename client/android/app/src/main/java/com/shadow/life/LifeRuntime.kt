package com.shadow.life

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Each Android host supplies the destination for its own device notifications. */
internal fun lifeWorkspaceIntent(context: Context, metadata: String = "com.shadow.life.DEVICE_ACTIVITY"): Intent {
    val app = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
    val target = app.metaData?.getString(metadata) ?: app.metaData?.getString("com.shadow.life.WORKSPACE_ACTIVITY")
        ?: "com.shadow.life.MainActivity"
    return Intent().setClassName(context.packageName, target)
}

suspend fun ShadowApp.enqueueLifeCommand(
    context: Context,
    capability: String,
    input: JSONObject,
    stableCommandId: String? = null,
    expectedAccountId: String? = null,
    expectedOwner: ProductSession? = null,
): OperationReceipt = withContext(Dispatchers.IO) {
    val session = sessions.active() ?: error("请先登录 Shadow Life")
    check((expectedAccountId == null || session.accountId == expectedAccountId) &&
        (expectedOwner == null || session.sameCaptureOwner(expectedOwner))) { "账号已切换，请在当前账号重新输入" }
    val id = stableCommandId ?: "cmd_android_" + UUID.randomUUID().toString().replace("-", "")
    val body = JSONObject().put("protocol", "shadow.command").put("capability", capability)
        .put("command_id", id).put("input", input)
    queue.enqueueCommand(session, id, capability, body.toString())
    SyncScheduler.schedule(context, session.accountId)
    OperationReceipt(capability, id, queued = true)
}

internal suspend fun ShadowApp.enqueueActivities(
    context: Context, items: JSONArray, accountId: String, recordExpenses: Boolean = false, expectedOwner: ProductSession? = null,
    stableCommandId: String? = null,
): OperationReceipt = withContext(Dispatchers.IO) {
    val input = JSONObject().put("device_id", sessions.installationId()).put("items", items)
    if (recordExpenses) input.put("record_expenses", true)
    enqueueLifeCommand(context, "life.ingest_activity", input, stableCommandId, expectedAccountId = accountId, expectedOwner = expectedOwner)
}

internal fun ProductSession?.sameCaptureOwner(expected: ProductSession?): Boolean = this != null && expected != null &&
    accountId == expected.accountId && subjectId == expected.subjectId && generation == expected.generation && apiBase == expected.apiBase

internal fun Intent.bindCaptureOwner(owner: ProductSession?): Intent = apply {
    if (owner != null) putExtra("account_id", owner.accountId).putExtra("account_subject", owner.subjectId)
        .putExtra("account_generation", owner.generation)
}

/** Older service notifications omit the generation. New host controls are bound to the initiating session. */
internal fun Intent?.matchesCaptureOwner(app: ShadowApp): Boolean {
    if (this == null || !hasExtra("account_generation")) return true
    val owner = app.activeCaptureSession() ?: return false
    return getStringExtra("account_id") == owner.accountId && getLongExtra("account_generation", -1) == owner.generation &&
        (!hasExtra("account_subject") || getStringExtra("account_subject") == owner.subjectId)
}

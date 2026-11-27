package com.shadow.life

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** System permission settings can open this page before Life has a signed-in account. */
class HealthPermissionsActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            LifeTheme(Appearance.System) {
                LifeSystemBars(window)
                Surface(Modifier.fillMaxSize()) {
                    Column(
                        modifier = Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Text("健康数据权限说明", style = MaterialTheme.typography.headlineMedium)
                        Text("Life 从 Health Connect 读取你授权的体重、步数、睡眠和锻炼记录，用于展示体重趋势、日常活动和训练历史。")
                        Text("同步到哪里", style = MaterialTheme.typography.titleMedium)
                        Text("开启同步后，Life 将记录和数据来源放入手机的加密队列，并同步到你当前登录的 Life 账号。首次读取最近 30 天，此后同步变更。")
                        Text("怎样管理权限", style = MaterialTheme.typography.titleMedium)
                        Text("你可以在 Health Connect 的应用权限中逐项授权或撤回。允许后台读取后，Life 也能在后台同步。撤回某项读取权限后，Life 停止从 Health Connect 读取该类新数据。")
                        Button(onClick = { finish() }) { Text("完成") }
                    }
                }
            }
        }
    }
}

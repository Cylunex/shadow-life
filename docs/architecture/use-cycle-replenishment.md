# 消耗品余量与折叠订单明细

## 事实边界

`money.set_use_cycle` 保存一个具体包装的开始/结束、初始量、统一量纲、预计日用量、补货阈值或
提前天数、时区与提醒开关。历史周期迁移后保持 `match_mode=none`、`reminder_enabled=false`，
不会突然把旧摄入扣进库存。只追踪而不提醒仍是有效模式。

余量不是可修改的库存数字，而是每次从当前有效事实重算：只有用户明确选择的精确名称或
`food_ref_id` 能匹配；已删除摄入和旧修订不参与。`g/kg`、`ml/L`、`count/个/件` 各自在同一
量纲内换算，包、袋、份等不明规格单位会进入 `incompatible_units`，绝不相加。初始规格未知时
状态固定为 `needs_specification`，余量和预计耗尽日为 `null`，Worker 不创建通知。

达到数量阈值或预计耗尽日进入提前窗口后，Worker 以 `(subject, use_cycle, cycle_id,
replenishment)` 唯一键写入现有通知表。重复运行不会重复提醒。将周期更新为
`state=replenished` 会结束当前包装并关闭仍待处理的提醒；新包装应建立新周期，避免把两包的
摄入混在同一余额中。

## 折叠订单

迁移只把名称以“等多件”结尾的原商品行标为 `folded_summary`，原文、订单、来源与金额均保留。
折叠摘要不再冒充完整商品，也不进入商品榜。`life.update_purchase_items` 在同一事务锁定
`consumption_record.expected_revision`，把记录、purchase 与全部旧商品行写入修订快照，再追加
或修正具体商品行并递增聚合版本；标准命令幂等机制防止重放重复追加。

统计覆盖率分别公开 `folded_orders`、`supplemented_orders`、`complete_item_orders` 与
`excluded_folded_lines`。补录不会新建订单、金额或付款；商品行金额未知时保持未知。

## 2026-06-13 京东燕麦的安全更新顺序

以下是部署迁移后的操作模板，不在本次开发中执行：

1. 用 `GET /api/life/records/record_6cb1427cb184b7bab2cd290a` 读取当前 `revision` 和原折叠
   `purchase_items[].id`，同时确认 purchase 仍为
   `purchase_40728eb0df8ed25e19c8d441`、付款仍为 CNY 225.96。
2. 以新的 `command_id` 调用 `life.update_purchase_items`。`expected_revision` 使用上一步读到的
   版本，`folded_item_ids` 放原摘要行 ID，`changes` 追加：

   ```json
   {
     "record_id": "record_6cb1427cb184b7bab2cd290a",
     "expected_revision": 1,
     "detail_state": "supplemented",
     "folded_item_ids": ["REPLACE_FOLDED_PURCHASE_ITEM_ID"],
     "changes": [{
       "action": "append",
       "item": {"raw_name": "西麦即食燕麦片，共1854g，3袋", "quantity": "1854", "unit": "g"}
     }],
     "reason": "订单来源将多件商品折叠为首件摘要；按用户确认补录燕麦总规格"
   }
   ```

   示例中的版本 `1` 必须替换成读取值。保存返回的 `changed_item_id` 是燕麦商品行 ID。若版本
   冲突，重新读取后人工核对，不重复提交新订单。
3. 用 `money.planning` 读取 `plan_d52190ce250045c08a459961ee06a053` 的当前完整字段与版本，
   再用 `money.set_use_cycle` 更新；除下面字段外保留读取值：

   ```json
   {
     "cycle_id": "plan_d52190ce250045c08a459961ee06a053",
     "expected_revision": 1,
     "purchase_record_id": "record_6cb1427cb184b7bab2cd290a",
     "purchase_item_id": "REPLACE_CHANGED_ITEM_ID",
     "item_name": "西麦燕麦（最后一袋，已开封）",
     "started_on": "2026-09-15",
     "state": "active",
     "initial_quantity": "618",
     "quantity_unit": "g",
     "expected_daily_usage": "45",
     "replenish_threshold": "90",
     "time_zone": "Asia/Shanghai",
     "match_mode": "exact_name",
     "match_value": "西麦燕麦",
     "reminder_enabled": true
   }
   ```

   90g 是按 45g/日取两天余量的默认阈值，可按用户偏好修改。只有后续有效摄入项的名称精确为
   “西麦燕麦”（Unicode/空白规范化后）才会扣减；需要别名时应显式更新 `match_value` 或使用稳定
   `food_ref_id`。
4. 补货完成后再次读取最新版本，并将同一周期完整更新为 `state=replenished`、
   `ended_on=实际完成日期`。下一袋另建周期。

## 回滚

按逆序执行本实现的两个回滚文件：

- `packages/database/migrations/down/0039_purchase_item_detail_repair.sql`
- `packages/database/migrations/down/0038_use_cycle_replenishment.sql`

先回滚 0039，再回滚 0038。0038 回滚会删除 `source_type=use_cycle` 的通知，然后移除新增字段；
原订单、金额、摘要文本、摄入与周期基础字段均保留。

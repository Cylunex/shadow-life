import { z } from "zod";
import { addIntakeInputSchema, annotateLibraryItemInputSchema, addMealPaymentInputSchema, addReservationInputSchema, attachMealSourceInputSchema, captureLibraryItemInputSchema, commandId, correctHealthMeasurementInputSchema, correctIntakeInputSchema, correctMealInputSchema, correctMoneyEntryInputSchema, correctPurchaseInputSchema, correctReservationInputSchema, correctTripInputSchema, createTripInputSchema, domainRecordsInputSchema, domainRecordsResultSchema, executionResultSchema, getOperationInputSchema, healthDailyInputSchema, healthSourcesInputSchema, healthSourcesResultSchema, healthTrendInputSchema, healthTrendResultSchema, ingestHealthBatchInputSchema, ingestHealthRawInputSchema, lifeRecordInputSchema, lifeTimelineInputSchema, lifeTimelineResultSchema, lifeTodayInputSchema, lifeTodayResultSchema, linkMealConsumptionInputSchema, listMealsInputSchema, listMealsResultSchema, moneyImportReviewInputSchema, moneyImportReviewResultSchema, moneyPlanningInputSchema, moneySummaryInputSchema, moneySummarySchema, publishTripPlanInputSchema, recordDiningInputSchema, recordHealthMeasurementInputSchema, recordMealCommandEnvelopeSchema, recordMealFromTemplateInputSchema, recordMealInputSchema, recordMoneyEntryInputSchema, recordPurchaseInputSchema, recordRefundInputSchema, recordTripSegmentInputSchema, recordVisitInputSchema, registerLibraryDerivationInputSchema, removeIntakeInputSchema, resolveMoneyImportCandidateInputSchema, resourceDetailInputSchema, resourceDetailResultSchema, saveMealTemplateInputSchema, savePlaceInputSchema, setBudgetInputSchema, setHealthPlanInputSchema, setHealthSourceStateInputSchema, setMoneyImportRuleInputSchema, setPersonalAliasInputSchema, setRecurringOccurrenceInputSchema, setRecurringPlanInputSchema, setSpendingIntentInputSchema, setTripDayPlanInputSchema, setTripMemberInputSchema, setTripStopOutcomeInputSchema, setUseCycleInputSchema, stageMoneyImportInputSchema, startTripRunInputSchema, reviseLibraryItemInputSchema, voidRecordInputSchema, voidReservationInputSchema } from "./schemas.js";

function write(name: string, description: string, inputSchema: any, effects: readonly string[]) {
  return { name, description, inputSchema, commandSchema: z.object({ protocol:z.literal("shadow.command"),capability:z.literal(name),command_id:commandId,input:inputSchema }).strict(), resultSchema: executionResultSchema, possibleEffects: effects, idempotency: "required" as const, statusQuery: "operations.get", resolveEffects: () => effects };
}

export const capabilityRegistry = {
  "life.record_meal": {
    name: "life.record_meal",
    description: "记录一餐，并可在同一事务保存具有独立发生日期和时区的明确付款。",
    inputSchema: recordMealInputSchema,
    commandSchema: recordMealCommandEnvelopeSchema,
    resultSchema: executionResultSchema,
    possibleEffects: ["life.meal.write", "money.entry.write", "library.source.link"] as const,
    idempotency: "required" as const,
    statusQuery: "operations.get",
    resolveEffects(input: unknown): readonly string[] {
      const parsed = recordMealInputSchema.parse(input);
      return [
        "life.meal.write",
        ...(parsed.payment === undefined ? [] : ["money.entry.write"]),
        ...(parsed.source === undefined ? [] : ["library.source.link"])
      ];
    }
  },
  "life.record_purchase": { ...write("life.record_purchase", "记录消费内容，可选保存独立发生时间的支付。", recordPurchaseInputSchema, ["life.purchase.write", "money.entry.write"]), resolveEffects(input:unknown){const value=recordPurchaseInputSchema.parse(input);return value.payment===undefined?["life.purchase.write"]:["life.purchase.write","money.entry.write"];} },
  "life.record_dining":{...write("life.record_dining","一次提交原子保存用餐、消费、付款、到访与全部来源。",recordDiningInputSchema,["life.meal.write","life.purchase.write","money.entry.write","travel.visit.write","library.source.link"]),resolveEffects(input:unknown){const value=recordDiningInputSchema.parse(input);return["life.meal.write","life.purchase.write",...(value.payment?["money.entry.write"]:[]),...(value.visit?["travel.visit.write"]:[]),...(value.sources.length?["library.source.link"]:[])];}},
  "life.correct_meal":write("life.correct_meal","按版本修正餐次时间、类型和备注并保留快照。",correctMealInputSchema,["life.meal.write"]),
  "life.add_intake":write("life.add_intake","向既有餐次追加食物。",addIntakeInputSchema,["life.meal.write"]),
  "life.remove_intake":write("life.remove_intake","从餐次移除误录食物并保留修正历史。",removeIntakeInputSchema,["life.meal.write"]),
  "life.add_meal_payment":write("life.add_meal_payment","事后为餐次补记付款并正式关联。",addMealPaymentInputSchema,["life.meal.write","money.entry.write"]),
  "life.attach_meal_source":write("life.attach_meal_source","追加或替换餐照、订单截图等来源证据。",attachMealSourceInputSchema,["life.meal.write","library.source.link"]),
  "life.set_personal_alias":write("life.set_personal_alias","保存个人食物、商家、模板或支付方式别名。",setPersonalAliasInputSchema,["life.meal.write"]),
  "life.correct_intake": write("life.correct_intake", "按预期版本修正一条饮食明细并保留修正原因。", correctIntakeInputSchema, ["life.meal.write"]),
  "life.correct_purchase":write("life.correct_purchase","按预期版本修正消费描述并保留聚合快照。",correctPurchaseInputSchema,["life.purchase.write"]),
  "life.void_purchase":write("life.void_purchase","撤销一条消费；有关联退款时拒绝破坏金额关系。",voidRecordInputSchema,["life.purchase.write","money.entry.write"]),
  "life.link_meal_consumption":write("life.link_meal_consumption","使用明确证据关联用餐与消费，不分摊或重复金额。",linkMealConsumptionInputSchema,["life.meal.write","life.purchase.write"]),
  "life.save_meal_template":write("life.save_meal_template","新建或按版本更新用餐模板；历史实际摄入不随模板变化。",saveMealTemplateInputSchema,["life.meal.write"]),
  "life.record_meal_from_template":{...write("life.record_meal_from_template","按个人模板快照创建一餐，可补付款和来源。",recordMealFromTemplateInputSchema,["life.meal.write","money.entry.write","library.source.link"]),resolveEffects(input:unknown){const value=recordMealFromTemplateInputSchema.parse(input);return["life.meal.write",...(value.payment?["money.entry.write"]:[]),...(value.source?["library.source.link"]:[])];}},
  "money.record_entry": write("money.record_entry", "记录一笔明确发生的收入或支出。", recordMoneyEntryInputSchema, ["money.entry.write"]),
  "money.record_refund": write("money.record_refund", "记录针对原始账目的退款并保持关联。", recordRefundInputSchema, ["money.refund.write"]),
  "money.correct_entry":write("money.correct_entry","按预期版本修正金额事实；保留历史并重新校验退款余额。",correctMoneyEntryInputSchema,["money.entry.write"]),
  "money.void_entry":write("money.void_entry","撤销金额事实；汇总立即排除，历史仍保留。",voidRecordInputSchema,["money.entry.write"]),
  "money.set_budget": write("money.set_budget", "设置月度分类预算。", setBudgetInputSchema, ["money.budget.write"]),
  "money.set_recurring_plan": write("money.set_recurring_plan", "保存周期收支计划；到期不会自动造账。", setRecurringPlanInputSchema, ["money.plan.write"]),
  "money.set_spending_intent":write("money.set_spending_intent","保存消费意向并关联实际消费，不自动造账。",setSpendingIntentInputSchema,["money.plan.write"]),
  "money.set_use_cycle":write("money.set_use_cycle","记录物品从开始使用到完成或丢弃的使用周期。",setUseCycleInputSchema,["money.plan.write"]),
  "money.set_occurrence_state":write("money.set_occurrence_state","处理、延期或忽略一个周期事项实例。",setRecurringOccurrenceInputSchema,["money.plan.write"]),
  "money.stage_import":write("money.stage_import","确定性解析 CSV、JSON 或 Markdown 账单并生成待复核候选，不直接写入账目。",stageMoneyImportInputSchema,["money.entry.write"]),
  "money.resolve_import_candidate":write("money.resolve_import_candidate","确认或忽略一个账单候选；退款必须明确关联原交易。",resolveMoneyImportCandidateInputSchema,["money.entry.write"]),
  "money.set_import_rule":write("money.set_import_rule","新建、修正或停用精确匹配交易对方的确定性导入规则。",setMoneyImportRuleInputSchema,["money.entry.write"]),
  "health.record_measurement": write("health.record_measurement", "记录一项带单位的健康测量。", recordHealthMeasurementInputSchema, ["health.measurement.write"]),
  "health.correct_measurement":write("health.correct_measurement","按版本修正手工健康测量并保留原快照；设备事实必须经来源版本更新。",correctHealthMeasurementInputSchema,["health.measurement.write"]),
  "health.ingest_raw": write("health.ingest_raw", "接收带稳定来源身份和版本的健康原始记录。", ingestHealthRawInputSchema, ["health.raw.ingest"]),
  "health.ingest_batch": write("health.ingest_batch", "原子接收一页设备变更，并在全部持久化后推进按类型 cursor。", ingestHealthBatchInputSchema, ["health.raw.ingest"]),
  "health.set_source_state":write("health.set_source_state","记录设备权限撤销、cursor 过期或受控重扫状态。",setHealthSourceStateInputSchema,["health.raw.ingest"]),
  "health.set_plan":write("health.set_plan","新建或更新习惯、目标和训练计划。",setHealthPlanInputSchema,["health.measurement.write"]),
  "travel.create_trip": write("travel.create_trip", "创建一个有日期边界的旅程。", createTripInputSchema, ["travel.trip.write"]),
  "travel.correct_trip":write("travel.correct_trip","按版本修正旅程边界并保留快照。",correctTripInputSchema,["travel.trip.write"]),
  "travel.add_reservation":{...write("travel.add_reservation", "向现有旅程添加预订，可在同一事务关联票价付款。", addReservationInputSchema, ["travel.reservation.write","money.entry.write","library.source.link"]),resolveEffects(input:unknown){const value=addReservationInputSchema.parse(input);return["travel.reservation.write",...(value.fare?["money.entry.write"]:[]),...(value.source?["library.source.link"]:[])];}},
  "travel.correct_reservation":{...write("travel.correct_reservation","修正预订详情及候补、兑现、改签、取消或退款状态。",correctReservationInputSchema,["travel.reservation.write","library.source.link"]),resolveEffects(input:unknown){const value=correctReservationInputSchema.parse(input);return["travel.reservation.write",...(value.source?["library.source.link"]:[])];}},
  "travel.void_reservation":write("travel.void_reservation","作废误录预订并保留修订历史。",voidReservationInputSchema,["travel.reservation.write"]),
  "travel.record_segment":{...write("travel.record_segment","记录步行、骑行、打车、铁路等旅程段。",recordTripSegmentInputSchema,["travel.trip.write","library.source.link"]),resolveEffects(input:unknown){const value=recordTripSegmentInputSchema.parse(input);return["travel.trip.write",...(value.source?["library.source.link"]:[])];}},
  "travel.record_visit": {...write("travel.record_visit", "记录实际到访地点，可关联旅程。", recordVisitInputSchema, ["travel.visit.write","library.source.link"]),resolveEffects(input:unknown){const value=recordVisitInputSchema.parse(input);return["travel.visit.write",...(value.source?["library.source.link"]:[])];}},
  "travel.save_place":write("travel.save_place","保存稳定地点、标签和收藏状态。",savePlaceInputSchema,["travel.trip.write"]),
  "travel.set_day_plan":write("travel.set_day_plan","设置旅程某日的有序计划。",setTripDayPlanInputSchema,["travel.trip.write"]),
  "travel.set_member":write("travel.set_member","设置旅程成员角色和可见范围。",setTripMemberInputSchema,["travel.trip.write"]),
  "travel.publish_plan":write("travel.publish_plan","将当前日程发布为不可变版本，运行不会隐式切换。",publishTripPlanInputSchema,["travel.trip.write"]),
  "travel.start_run":write("travel.start_run","从一个明确的已发布计划版本开始或恢复本人旅程运行。",startTripRunInputSchema,["travel.trip.write"]),
  "travel.set_stop_outcome":write("travel.set_stop_outcome","记录本人运行中某个稳定停留点的到达或跳过结果。",setTripStopOutcomeInputSchema,["travel.trip.write"]),
  "library.capture": {...write("library.capture", "保存可追溯的资料条目和来源。", captureLibraryItemInputSchema, ["library.item.write","library.source.link"]),resolveEffects(input:unknown){const value=captureLibraryItemInputSchema.parse(input);return["library.item.write",...(value.source?["library.source.link"]:[])];}},
  "library.revise":write("library.revise","新增资料修订并生成内容证明。",reviseLibraryItemInputSchema,["library.item.write"]),
  "library.annotate":write("library.annotate","为资料的明确位置添加批注。",annotateLibraryItemInputSchema,["library.item.write"]),
  "library.register_derivation":write("library.register_derivation","登记资料派生文件及处理器版本。",registerLibraryDerivationInputSchema,["library.item.write"]),
  "life.today":{name:"life.today",description:"按实际发生日读取获准领域的今日指标与数据新鲜度。",inputSchema:lifeTodayInputSchema,commandSchema:lifeTodayInputSchema,resultSchema:lifeTodayResultSchema,possibleEffects:["life.meal.read","money.entry.read","health.measurement.read","travel.trip.read","library.item.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["life.meal.read","money.entry.read","health.measurement.read","travel.trip.read","library.item.read"] as const},
  "life.timeline":{name:"life.timeline",description:"从一个数据库快照按真实发生时间分页读取获准领域的统一时间线。",inputSchema:lifeTimelineInputSchema,commandSchema:lifeTimelineInputSchema,resultSchema:lifeTimelineResultSchema,possibleEffects:["life.meal.read","money.entry.read","health.measurement.read","travel.trip.read","library.item.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["life.meal.read","money.entry.read","health.measurement.read","travel.trip.read","library.item.read"] as const},
  "life.list_meals": {
    name: "life.list_meals", description: "List the subject's meals from the shared life facts.",
    inputSchema: listMealsInputSchema, commandSchema: listMealsInputSchema, resultSchema: listMealsResultSchema,
    possibleEffects: ["life.meal.read"] as const, idempotency: "not-applicable" as const, statusQuery: "operations.get",
    resolveEffects: () => ["life.meal.read"] as const
  },
  "money.summarize": {
    name: "money.summarize", description: "Return the exact CNY expense summary from MoneyEntry facts.",
    inputSchema: moneySummaryInputSchema, commandSchema: moneySummaryInputSchema, resultSchema: moneySummarySchema,
    possibleEffects: ["money.summary.read"] as const, idempotency: "not-applicable" as const, statusQuery: "operations.get",
    resolveEffects: () => ["money.summary.read"] as const
  },
  "money.records":{name:"money.records",description:"读取当前主体的收支记录。",inputSchema:domainRecordsInputSchema,commandSchema:domainRecordsInputSchema,resultSchema:domainRecordsResultSchema,possibleEffects:["money.entry.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["money.entry.read"] as const},
  "health.records":{name:"health.records",description:"读取手工与来源归一化后的健康事实及其有效状态。",inputSchema:domainRecordsInputSchema,commandSchema:domainRecordsInputSchema,resultSchema:domainRecordsResultSchema,possibleEffects:["health.measurement.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["health.measurement.read"] as const},
  "health.get_record":{name:"health.get_record",description:"读取一条健康事实及其原始来源身份，不回传设备游标。",inputSchema:resourceDetailInputSchema,commandSchema:resourceDetailInputSchema,resultSchema:resourceDetailResultSchema,possibleEffects:["health.measurement.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["health.measurement.read"] as const},
  "health.trend":{name:"health.trend",description:"按类型读取健康趋势、日期覆盖和来源，不补造缺失点。",inputSchema:healthTrendInputSchema,commandSchema:healthTrendInputSchema,resultSchema:healthTrendResultSchema,possibleEffects:["health.measurement.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["health.measurement.read"] as const},
  "health.sources":{name:"health.sources",description:"读取健康来源、权限状态和按设备/类型的同步状态。",inputSchema:healthSourcesInputSchema,commandSchema:healthSourcesInputSchema,resultSchema:healthSourcesResultSchema,possibleEffects:["health.measurement.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["health.measurement.read"] as const},
  "life.get_record":{name:"life.get_record",description:"按显式分区读取一条用餐、消费、付款或来源聚合；未指定时只返回调用方获准的分区。",inputSchema:lifeRecordInputSchema,commandSchema:lifeRecordInputSchema,resultSchema:resourceDetailResultSchema,possibleEffects:["life.meal.read","money.entry.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects(input:unknown){const value=lifeRecordInputSchema.parse(input);if(!value.sections)return["life.meal.read","money.entry.read"] as const;return[...(value.sections.some(section=>section!=="money")?["life.meal.read"]:[]),...(value.sections.includes("money")?["money.entry.read"]:[])];}},
  "money.planning":{name:"money.planning",description:"读取一个月的预算、周期事项、消费意向和使用周期。",inputSchema:moneyPlanningInputSchema,commandSchema:moneyPlanningInputSchema,resultSchema:resourceDetailResultSchema,possibleEffects:["money.entry.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["money.entry.read"] as const},
  "money.import_review":{name:"money.import_review",description:"读取一个账单导入批次及其原始行、问题、重复提示和复核状态。",inputSchema:moneyImportReviewInputSchema,commandSchema:moneyImportReviewInputSchema,resultSchema:moneyImportReviewResultSchema,possibleEffects:["money.entry.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["money.entry.read"] as const},
  "health.daily":{name:"health.daily",description:"读取指定日期可追溯的健康日汇总。",inputSchema:healthDailyInputSchema,commandSchema:healthDailyInputSchema,resultSchema:resourceDetailResultSchema,possibleEffects:["health.measurement.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["health.measurement.read"] as const},
  "travel.records":{name:"travel.records",description:"分页读取当前主体可见的旅程、预订、行程段、到访、日程和地点。",inputSchema:domainRecordsInputSchema,commandSchema:domainRecordsInputSchema,resultSchema:domainRecordsResultSchema,possibleEffects:["travel.trip.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["travel.trip.read"] as const},
  "travel.get_trip":{name:"travel.get_trip",description:"读取可见旅程的完整上下文、日程和成员。",inputSchema:resourceDetailInputSchema,commandSchema:resourceDetailInputSchema,resultSchema:resourceDetailResultSchema,possibleEffects:["travel.trip.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["travel.trip.read"] as const},
  "library.records":{name:"library.records",description:"分页搜索当前主体的资料标题、正文和标签。",inputSchema:domainRecordsInputSchema,commandSchema:domainRecordsInputSchema,resultSchema:domainRecordsResultSchema,possibleEffects:["library.item.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["library.item.read"] as const},
  "library.get_item":{name:"library.get_item",description:"读取资料的修订、批注、派生产物和内容证明。",inputSchema:resourceDetailInputSchema,commandSchema:resourceDetailInputSchema,resultSchema:resourceDetailResultSchema,possibleEffects:["library.item.read"] as const,idempotency:"not-applicable" as const,statusQuery:"operations.get",resolveEffects:()=>["library.item.read"] as const},
  "operations.get": {
    name: "operations.get", description: "Read a visible deterministic execution receipt.",
    inputSchema: getOperationInputSchema, commandSchema: getOperationInputSchema, resultSchema: executionResultSchema,
    possibleEffects: ["operations.read"] as const, idempotency: "not-applicable" as const, statusQuery: "operations.get",
    resolveEffects: () => ["operations.read"] as const
  }
} as const;

export type CapabilityName = keyof typeof capabilityRegistry;

import { z } from "zod";
import { capabilityRegistry, type CapabilityName } from "./registry.js";
import type { AgentScenario, AgentScenarioName, AgentTerm } from "./agent-schemas.js";
import workflowExamples from "../../../skills/life-operator/references/examples.json" with { type: "json" };

export const agentDiscoveryInstructions = [
  "For planning tasks, use agent.workspace with explicit date range before decisions. Use current intentions and scoped validity; expand agent.objects for sources, agent.tasks for checkpoints and agent.learning only as evidence-backed derived context. Ordinary domain writes still use their commands and receipts.",
  "Use agent.context with explicit scenario, search terms, date range or source references for task-related history. Sources are query evidence, not save receipts; unknown facts stay unknown. Use detail tools to expand. Never infer consumption from purchase or combine currencies.",
  "Use agent.discover to find authorized tools by task, business term or scenario before guessing tool names and input shapes.",
  "Use agent.glossary for business definitions and fact boundaries; use the returned lookup tools for personal aliases and live facts.",
  "Use agent.scenarios for task bundles. Discovery and catalog results are metadata, never proof of a saved fact or an authority grant."
] as const;

// Business metadata belongs to the same release as the contracts. No user facts or credentials.
export const agentScenarios: readonly AgentScenario[] = [
  { name: "daily", title: "日常记录", description: "记录吃饭、购买、测量和日常生活，核对记录完整性。", capabilities: ["agent.workspace", "agent.intentions", "agent.objects", "agent.tasks", "agent.learning", "agent.changes", "agent.set_intention", "agent.save_task", "agent.save_learning", "agent.set_subscription", "agent.ack_changes", "agent.export", "agent.restore", "agent.context", "life.get_record", "health.get_record", "life.record_meal", "life.record_dining", "life.record_purchase", "life.correct_meal", "life.correct_purchase", "life.food_catalog", "life.daily_record_check", "life.today", "life.day", "life.timeline", "life.search", "health.record_measurement"], instructions: ["已吃下与只购买分开记录；完整就餐优先 record_dining。", "照常先查目录或模板；未知金额、营养和时刻省略。"] },
  { name: "spending", title: "消费复盘", description: "查询支出与退款、消费排名、体验评价、次卡和消耗品。", capabilities: ["agent.workspace", "agent.intentions", "agent.objects", "agent.tasks", "agent.learning", "agent.changes", "agent.set_intention", "agent.save_task", "agent.save_learning", "agent.set_subscription", "agent.ack_changes", "agent.export", "agent.restore", "agent.context", "money.record_entry", "money.record_refund", "money.correct_entry", "money.void_entry", "money.records", "money.summarize", "life.consumption_stats", "life.get_record", "life.correct_purchase", "money.service_cards", "money.save_service_card", "money.record_service_card_use", "money.set_use_cycle", "money.record_consumable_use", "money.planning", "money.foreign_entries", "money.record_foreign_entry"], instructions: ["按币种和统计期间汇总，展示覆盖率。", "评分和复购意愿来自明确评价；未知不填默认分。", "买次卡不等于使用，消耗速率估计不等于实际使用。"] },
  { name: "health", title: "健康记录", description: "记录测量与实际训练，查询睡眠、趋势和设备来源。", capabilities: ["agent.workspace", "agent.intentions", "agent.objects", "agent.tasks", "agent.learning", "agent.changes", "agent.set_intention", "agent.save_task", "agent.save_learning", "agent.set_subscription", "agent.ack_changes", "agent.export", "agent.restore", "agent.context", "health.record_measurement", "health.correct_measurement", "health.record_workout", "health.records", "health.get_record", "health.daily", "health.trend", "health.sources", "health.sleep_insights", "health.workout_progression", "health.set_plan"], instructions: ["保存测量来源、真实单位与发生时间。", "区分训练计划与实际训练，不推断缺失数据或健康因果。"] },
  { name: "travel", title: "旅行规划", description: "组织旅程、候选地点、日程、预订与实际到访。", capabilities: ["agent.workspace", "agent.intentions", "agent.objects", "agent.tasks", "agent.learning", "agent.changes", "agent.set_intention", "agent.save_task", "agent.save_learning", "agent.set_subscription", "agent.ack_changes", "agent.export", "agent.restore", "agent.context", "travel.create_trip", "travel.correct_trip", "travel.save_place", "travel.save_map", "travel.set_day_plan", "travel.add_reservation", "travel.correct_reservation", "travel.record_segment", "travel.record_visit", "travel.records", "travel.get_trip", "travel.workspace", "travel.export", "travel.preview_portable"], instructions: ["候选地点和计划不代表已经到访。", "修改前读取当前版本；不把几何连线当作道路路线。"] },
  { name: "library", title: "资料与回忆", description: "保存笔记、原件和体验感受，检索资料与往年今日。", capabilities: ["agent.workspace", "agent.intentions", "agent.objects", "agent.tasks", "agent.learning", "agent.changes", "agent.set_intention", "agent.save_task", "agent.save_learning", "agent.set_subscription", "agent.ack_changes", "agent.export", "agent.restore", "agent.context", "library.capture", "library.revise", "library.annotate", "library.set_reading_state", "library.records", "library.get_item", "life.memories", "life.day", "life.get_record", "travel.get_trip"], instructions: ["原件与识别结果分开，感受和共同约定作为明确笔记保存。", "关联已有消费或旅程，不重新制造金额或到访事实。"] },
  { name: "planning", title: "生活规划", description: "管理项目、行动项、餐单购物清单、预算和周期事项。", capabilities: ["agent.workspace", "agent.intentions", "agent.objects", "agent.tasks", "agent.learning", "agent.changes", "agent.set_intention", "agent.save_task", "agent.save_learning", "agent.set_subscription", "agent.ack_changes", "agent.export", "agent.restore", "agent.context", "life.get_record", "life.projects", "life.save_project", "life.save_action_item", "life.planning_agenda", "life.meal_planning", "life.save_meal_plan", "life.set_food_stock", "life.build_shopping_list", "life.update_shopping_item", "life.save_food", "life.save_recipe", "life.record_meal_from_recipe", "money.set_budget", "money.set_recurring_plan", "money.set_spending_intent", "money.set_occurrence_state", "money.planning", "life.reviews", "life.generate_review", "life.owned_items", "life.save_owned_item", "life.record_owned_item_event"], instructions: ["计划、提醒和购物清单不生成实际消费、摄入或完成记录。", "跨领域项目只保存稳定引用；写入沿用同一 Executor。"] }
];

function term(id: string, title: string, aliases: string[], definition: string, boundaries: string[], capabilities: CapabilityName[], lookup_tools: CapabilityName[] = []): AgentTerm {
  return { id, title, aliases, definition, boundaries, capabilities, lookup_tools };
}
export const agentTerms: readonly AgentTerm[] = [
  {id:"personal_intent",title:"个人目标与偏好",aliases:["意图","临时限制","个人数据底座","跨会话任务"],definition:"明确目标偏好与有范围的限制属于个人意图；任务检查点、实际记录和派生经验各自保存。",capabilities:["agent.workspace","agent.intentions","agent.set_intention","agent.tasks","agent.save_task","agent.learning","agent.save_learning"],lookup_tools:["agent.workspace","agent.intentions","agent.tasks"],boundaries:["计划不代表实际发生","推导不能替代明确偏好"]},
  term("intake", "实际摄入", ["吃了", "喝了", "用餐", "早餐", "午餐", "晚餐", "营养", "热量"], "实际吃下或喝下的食物及份量，属于餐次事实。", ["购买、赠品、订单列示不证明摄入。", "未知营养不填零；估算注明依据。"], ["life.record_meal", "life.record_dining", "life.list_meals", "life.correct_meal", "life.get_record"], ["life.food_catalog"]),
  term("purchase", "购买", ["买了", "订单", "外卖", "商家", "收据"], "商家、购买明细和可选独立支付事实。", ["付款日与实际发生日独立。", "购买数量不代表吃下或当前库存。"], ["life.record_purchase", "life.record_dining", "life.correct_purchase", "life.get_record"]),
  term("expense", "支出", ["花费", "花了多少钱", "消费", "开销", "账单", "记账"], "明确记录的支出金额；汇总按原币种分组。", ["金额未知不当作零。", "问花费时先区分支出、净支出或商品金额。"], ["money.record_entry", "money.records", "money.summarize", "life.consumption_stats"]),
  term("money-void", "误录账目作废", ["作废", "撤销账目", "删除重复账目", "误录", "重复入账"], "将错误的金额记录软作废，不计入有效汇总。", ["先核对精确记录和当前修订，只作废误录条目。", "历史记录仍可搜索，统计有效账目时只计 confirmed。"], ["money.void_entry", "life.get_record", "money.records"]),
  term("net-spend", "净支出", ["退款后", "实际花费", "退了多少", "退款"], "在既有收支口径下扣除有效退款后的支出。", ["退款关联原始记录；无效或撤销退款不重复扣减。", "不跨币种相加。"], ["money.record_refund", "money.summarize", "money.records"]),
  term("experience", "消费体验", ["评分", "评价", "感受", "满意", "值得", "再去", "复购", "还会买", "约会"], "对已记录消费的明确评分、复购意愿和感受备注。", ["评分未知保持未知，不默认中立。", "主观体验不改写金额、摄入或健康事实。"], ["life.correct_purchase", "life.get_record", "life.consumption_stats", "library.capture"]),
  term("food-alias", "食物与个人别名", ["照常", "老样子", "常喝", "常吃", "别名", "习惯叫法"], "用户显式保存的食物、商家、模板或支付方式叫法。", ["先查询获准目录，再复用明确匹配。", "历史时刻不复制为本次真实时刻。"], ["life.set_personal_alias", "life.record_meal_from_template", "life.food_catalog"], ["life.food_catalog"]),
  term("card", "次卡权益", ["理发卡", "洗车卡", "课时包", "次卡", "扣次", "核销"], "购买的预付使用权益及明确实际使用记录。", ["购卡不代表使用，使用不重复记支出。"], ["money.save_service_card", "money.record_service_card_use", "money.service_cards"]),
  term("consumable", "消耗品使用", ["余量", "补货", "快用完", "库存", "开封", "消耗品"], "关联购买明细的使用周期、实际使用及独立速率估算。", ["待开封不是当前存量。", "估计速率不当作实际扣减。"], ["money.set_use_cycle", "money.record_consumable_use", "money.planning", "life.record_purchase"]),
  term("food-stock", "食品库存", ["食材", "保质期", "过期", "临期", "冰箱", "食品库存", "库存", "food stock", "food expiry", "pantry", "expiration"], "显式维护的食品批次、余量和到期日，用于餐单与购物缺口。", ["购买或勾选买到不自动改变食品库存。", "库存变化不代表已经吃下。"], ["life.set_food_stock", "life.meal_planning", "life.build_shopping_list"], ["life.meal_planning"]),
  term("owned-item", "物品与售后期限", ["物品", "保修", "过保", "退货期", "还能退", "能退货", "放在哪", "存放位置", "说明书", "warranty", "return window", "owned items"], "显式加入的物品、结构化位置、退货与保修期限及维护资料。", ["按返回的 on/time_zone 和 attention 判断日历日期，不用手机或模型时钟重新推断。", "truncated=true 时仅代表已加载物品；没有日期不是没有保修。"], ["life.owned_items", "life.save_owned_item", "life.record_owned_item_event"], ["life.owned_items"]),
  term("budget", "预算使用", ["预算", "预算剩余", "预算超支", "monthly budget", "budget"], "按月份与分类查看预算和已确认支出原额。", ["spent 是支出原额，退款不冲减预算已用额。", "分币种读取，覆盖截断时不声称已查完。"], ["money.planning", "money.set_budget", "money.summarize"], ["money.planning"]),
  term("recurring", "周期事项与期次", ["订阅", "续费", "周期费用", "到期账单", "扣费提醒", "稍后提醒", "subscription", "recurring", "renewal"], "区分周期计划、原定期次、调整后的提醒日期与已关联的实际账目。", ["处理或跳过期次不会生成支出；计划金额不代表实际付款。", "未知金额保持未知；按原定月份查询时仍显示调整后的日期。"], ["money.planning", "money.set_recurring_plan", "money.set_occurrence_state", "life.planning_agenda"], ["money.planning", "life.planning_agenda"]),
  term("measurement", "健康测量", ["体重", "体脂", "血压", "心率", "步数", "测量", "健康趋势"], "带单位、时间和来源的健康读数。", ["设备事实与手工测量保留来源。", "缺失不补造，不自动解释健康因果。"], ["health.record_measurement", "health.correct_measurement", "health.trend", "health.daily", "health.sources"]),
  term("sleep", "睡眠", ["睡了多久", "入睡", "睡觉", "睡眠规律"], "按主睡眠会话和指定期间统计时长与覆盖率。", ["不足三晚不推断入睡规律。"], ["health.sleep_insights", "health.records"]),
  term("workout", "训练计划与实际训练", ["训练", "锻炼", "练了", "健身", "哑铃", "徒手", "组数", "次数", "训练进度"], "训练菜单和计划与实际完成的动作、组数和重量分别记录；进度查询引用已执行训练。", ["计划和菜单不证明已经练过，只记录明确完成的组。", "时长进度规则不用于力量训练自动加重量或次数；没有可比执行数据不生成建议。"], ["health.set_plan", "health.record_workout", "health.workout_progression", "health.records", "health.get_record"], ["health.records", "health.workout_progression"]),
  term("visit", "实际到访", ["去过", "到访", "打卡", "游览"], "明确发生的地点到访，与收藏和旅行计划独立。", ["收藏地点不代表实际到访。"], ["travel.record_visit", "travel.get_trip", "travel.records"]),
  term("trip", "旅程与候选地点", ["旅游", "旅行", "出游", "景点", "行程", "预订", "酒店"], "组织候选地点、预订与日程的旅程。", ["计划不生成到访事实或实际费用。"], ["travel.create_trip", "travel.save_place", "travel.set_day_plan", "travel.add_reservation", "travel.workspace", "travel.get_trip"]),
  term("plan", "计划与行动", ["预算", "提醒", "周期", "待办", "购物清单", "餐单", "安排"], "未来目标、待执行行动和周期实例。", ["计划不等于事实，完成需明确记录。"], ["life.save_action_item", "life.planning_agenda", "life.save_meal_plan", "money.set_budget", "money.set_recurring_plan", "money.planning"]),
  term("memory", "回忆与共同约定", ["往年今日", "回忆", "纪念", "共同约定", "复盘", "笔记", "资料"], "源自已保存记录的回忆，以及用户明确写下的感受或约定。", ["往年今日使用原始记录，不生成未发生经历。", "笔记不自动产生收支或健康结论。"], ["life.memories", "life.day", "library.capture", "library.records", "library.annotate"]),
  term("recovery", "执行回执与恢复", ["保存成功", "重试", "超时", "结果未知", "重复", "修改", "版本冲突"], "服务端确认提交的回执是保存成功的依据。", ["未知结果先查原命令回执，再用同一命令键重试。", "冲突先读取当前修订，不换命令键绕过。"], ["operations.find", "operations.get", "life.get_record"])
];

export function capabilityExample(name: CapabilityName): Record<string, unknown> | undefined {
  const example = workflowExamples.find(item => item.capability === name);
  if (!example) return undefined;
  return example.arguments as Record<string, unknown>;
}
export function scenariosForCapability(name: string): AgentScenarioName[] {
  return agentScenarios.filter(scenario => scenario.capabilities.includes(name)).map(scenario => scenario.name);
}
export function buildAgentCatalogDocument() {
  return {
    terms: agentTerms,
    scenarios: agentScenarios,
    capabilities: Object.values(capabilityRegistry).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(item => ({
      name: item.name, description: item.description, domain: item.name.split(".")[0]!,
      mode: item.idempotency === "required" ? "write" as const : "read" as const,
      possible_effects: [...item.possibleEffects], scenarios: scenariosForCapability(item.name),
      ...((capabilityExample(item.name as CapabilityName)) ? { example: capabilityExample(item.name as CapabilityName) } : {}),
      input_schema: z.toJSONSchema(item.inputSchema), result_schema: z.toJSONSchema(item.resultSchema)
    }))
  };
}

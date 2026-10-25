import { useEffect, useState, type FormEvent } from "react";
import { moneyPlanningResultSchema } from "@shadow/contracts";
import type { Execute } from "./command-controller.js";
import { formatMoneyAmount } from "./money-display.js";

type Planning = ReturnType<typeof moneyPlanningResultSchema.parse>;
type Budget = Planning["budgets"][number];
const currentMonth = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 7);
const occurrenceLabels = { pending: "待处理", reminded: "已提醒", handled: "已处理", dismissed: "已跳过", snoozed: "已延后" };
const cadenceLabels = { daily: "每天", weekly: "每周", monthly: "每月", yearly: "每年", interval: "按间隔" };

export function MoneyPlanningPanel({ headers, capabilities, execute }: { headers: HeadersInit; capabilities: ReadonlySet<string>; execute: Execute }) {
  const [period, setPeriod] = useState(currentMonth), [data, setData] = useState<Planning>(), [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState<string>();
  const [budgetEditor, setBudgetEditor] = useState(false), [editing, setEditing] = useState<Budget>(), [category, setCategory] = useState(""), [amount, setAmount] = useState("");
  const [recurringEditor, setRecurringEditor] = useState(false), [title, setTitle] = useState(""), [planAmount, setPlanAmount] = useState(""), [cadence, setCadence] = useState("monthly"), [due, setDue] = useState(""), [missingDate, setMissingDate] = useState("skip");
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setData(undefined); setError(undefined);
    void fetch(`/api/money/planning?period=${encodeURIComponent(period)}`, { headers, signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`读取预算失败（HTTP ${response.status}）`);
      const body = moneyPlanningResultSchema.parse(await response.json());
      if (!controller.signal.aborted) setData(body);
    }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "读取预算失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, refresh]);
  function editBudget(budget?: Budget) { setEditing(budget); setCategory(budget?.category ?? ""); setAmount(budget?.amount ?? ""); setBudgetEditor(true); }
  async function saveBudget(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(undefined);
    try {
      await execute("money.set_budget", { period, category: category.trim() || null, amount: amount.trim(), currency: "CNY", ...(editing ? { expected_revision: editing.revision } : {}) }, `budget:${period}:${category.trim() || "all"}`);
      setBudgetEditor(false); setRefresh(value => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存预算失败"); } finally { setPending(false); }
  }
  async function saveRecurring(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(undefined);
    try {
      await execute("money.set_recurring_plan", { title: title.trim(), cadence, next_due_on: due, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, missing_date_policy: missingDate, ...(planAmount.trim() ? { amount: planAmount.trim(), currency: "CNY" } : {}) }, "money-planning:new-recurring");
      setTitle(""); setPlanAmount(""); setRecurringEditor(false); setPeriod(due.slice(0, 7)); setRefresh(value => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存周期事项失败"); } finally { setPending(false); }
  }
  async function mark(occurrence: Planning["occurrences"][number], state: "handled" | "dismissed" | "pending") {
    setPending(true); setError(undefined);
    try {
      await execute("money.set_occurrence_state", { occurrence_id: occurrence.id, expected_revision: occurrence.revision, state, effective_due_on: occurrence.effective_due_on, feedback: occurrence.feedback, ...(occurrence.linked_record_id ? { linked_record_id: occurrence.linked_record_id } : {}) }, `occurrence:${occurrence.id}`);
      setRefresh(value => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "更新周期事项失败"); } finally { setPending(false); }
  }
  return <section className="wide money-planning"><div className="panel-heading"><div><span className="eyebrow">BUDGET & RECURRING</span><h2>预算与周期事项</h2></div><label>查看月份<input type="month" required value={period} disabled={pending} onChange={event => { if (event.target.value) { setPeriod(event.target.value); setBudgetEditor(false); } }}/></label></div>
    <p>预算按确认的支出原额对照，退款不冲减这里的已用金额。周期事项标记只更新安排状态。</p>
    <div className="actions">{capabilities.has("money.set_budget") && <button type="button" disabled={pending || loading} onClick={() => editBudget()}>＋ 设置预算</button>}{capabilities.has("money.set_recurring_plan") && <button type="button" className="secondary" disabled={pending} onClick={() => setRecurringEditor(value => !value)}>{recurringEditor ? "收起周期事项" : "＋ 周期事项"}</button>}<button type="button" className="secondary" disabled={loading || pending} onClick={() => setRefresh(value => value + 1)}>刷新</button></div>
    {error && <p role="alert" className="inline-error">{error}</p>}{loading && <p role="status">正在读取所选月份…</p>}
    {budgetEditor && <form className="compact-form" onSubmit={saveBudget}><h3>{editing ? "修改预算" : "设置预算"} · {period}</h3><label>分类（空白表示总预算）<input value={category} disabled={Boolean(editing)} maxLength={80} onChange={event => setCategory(event.target.value)}/></label><label>预算金额（CNY）<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)}/></label><div className="actions"><button disabled={pending || loading}>保存预算</button><button type="button" className="secondary" disabled={pending} onClick={() => setBudgetEditor(false)}>取消</button></div></form>}
    {recurringEditor && <form className="compact-form" onSubmit={saveRecurring}><h3>新建周期事项</h3><label>事项名称<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)}/></label><label>金额（CNY，可留空）<input inputMode="decimal" value={planAmount} onChange={event => setPlanAmount(event.target.value)}/></label><label>周期<select value={cadence} onChange={event => setCadence(event.target.value)}><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label><label>下次日期<input type="date" required value={due} onChange={event => setDue(event.target.value)}/></label><label>遇到不存在的日期<select value={missingDate} onChange={event => setMissingDate(event.target.value)}><option value="skip">跳过该期</option><option value="last_day">使用当月最后一天</option></select></label><small>使用 {Intl.DateTimeFormat().resolvedOptions().timeZone} 时区；金额留空会保留为未知。</small><button disabled={pending}>保存周期事项</button></form>}
    {data && <><h3>{period} 预算</h3><div className="plan-grid">{data.budgets.map(budget => <article className="plan-card" key={budget.id}><b>{budget.category ?? "总预算"}</b><p>{formatMoneyAmount(budget.spent, budget.currency)} / {formatMoneyAmount(budget.amount, budget.currency)} {budget.currency}</p><small>已用（支出原额） / 预算 · 修订 {budget.revision}</small>{capabilities.has("money.set_budget") && budget.currency === "CNY" && <button type="button" className="secondary" disabled={pending} onClick={() => editBudget(budget)}>修改预算</button>}</article>)}</div>{!data.budgets.length && <p>本月尚未设置预算。</p>}{data.truncated.budgets && <p>预算仅显示前 {data.limits.budgets} 条。</p>}
      <h3>本月周期事项</h3><p>列出下次日期或原定期次在本月的事项；延后日期单独显示。计划金额是当前设置，不是每一期的实际付款。</p><ul className="action-list">{data.recurring_plans.map(plan => <li key={plan.id}><b>{plan.title}</b><small>{cadenceLabels[plan.cadence]}{plan.interval_days ? ` · ${plan.interval_days} 天` : ""} · 下次 {plan.next_due_on} · {plan.time_zone} · {({ active: "进行中", paused: "已暂停", ended: "已结束" })[plan.state]}</small><span>{plan.amount === null ? "金额未记录" : `${formatMoneyAmount(plan.amount, plan.currency)} ${plan.currency}`}</span></li>)}</ul>{!data.recurring_plans.length && <p>当前月份没有已加载的周期事项。</p>}{data.truncated.recurring_plans && <p>周期事项仅显示前 {data.limits.recurring_plans} 条。</p>}
      <h3>本月原定期次</h3><ul className="action-list occurrence-list">{data.occurrences.map(occurrence => <li key={occurrence.id}><b>{data.recurring_plans.find(plan => plan.id === occurrence.plan_id)?.title ?? "周期事项（详情未载入）"}</b><small>原定 {occurrence.original_due_on}{occurrence.effective_due_on !== occurrence.original_due_on ? ` · 调整至 ${occurrence.effective_due_on}` : ""}{occurrence.snoozed_until ? ` · 提醒延后至 ${new Date(occurrence.snoozed_until).toLocaleString()}` : ""}</small><span>{occurrenceLabels[occurrence.state]}{occurrence.linked_record_id ? " · 已关联记录" : ""}</span>{capabilities.has("money.set_occurrence_state") && <div className="actions">{occurrence.state !== "handled" && <button type="button" disabled={pending} onClick={() => void mark(occurrence, "handled")}>标记已处理</button>}{occurrence.state !== "dismissed" && <button type="button" className="secondary" disabled={pending} onClick={() => void mark(occurrence, "dismissed")}>跳过本期</button>}{occurrence.state !== "pending" && <button type="button" className="secondary" disabled={pending} onClick={() => void mark(occurrence, "pending")}>恢复待处理</button>}</div>}</li>)}</ul>{!data.occurrences.length && <p>本月没有已生成的期次。</p>}{data.truncated.occurrences && <p>期次仅显示前 {data.limits.occurrences} 条。</p>}</>}
  </section>;
}

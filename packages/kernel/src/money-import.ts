export type MoneyImportFormat = "csv" | "json" | "markdown";
export type MoneyImportEntryType = "expense" | "income" | "refund";
export type MoneyImportPlatform = "generic" | "meituan" | "jd" | "taobao" | "alipay" | "wechat";
export interface MoneyImportCandidate {
  raw: Record<string, unknown>;
  platform: MoneyImportPlatform;
  externalId?: string;
  /** The source event kind is immutable even when a user corrects the proposed accounting fields. */
  identityKind?: MoneyImportEntryType;
  proposed: Partial<{ entry_type: MoneyImportEntryType; amount: string; currency: "CNY"; occurred_on: string; time_zone: string; counterparty: string; category: string; payment_method: string; note: string }>;
  issues: string[];
  warnings: string[];
  appliedRuleIds?: string[];
}
export interface MoneyImportRule { id: string; matchValue: string; replacements: Partial<MoneyImportCandidate["proposed"]>; }

const aliases = {
  externalId: ["transaction_id", "transactionid", "id", "交易单号", "交易订单号", "交易号", "订单号", "流水号"],
  occurredOn: ["date", "occurred_on", "transaction_date", "交易日期", "日期", "时间", "交易时间"],
  amount: ["amount", "金额", "金额(元)", "金额（元）", "交易金额", "收支金额"],
  entryType: ["type", "entry_type", "direction", "收支类型", "类型", "收/支", "收支", "交易类型"],
  counterparty: ["merchant", "counterparty", "payee", "商家", "交易对方", "对方", "商户", "商户名称"],
  category: ["category", "分类", "交易分类"],
  paymentMethod: ["payment_method", "method", "支付方式", "付款方式", "收/付款方式"],
  currency: ["currency", "币种", "货币"],
  note: ["note", "memo", "description", "备注", "说明", "商品说明"]
} as const;
const platformHeaders: [MoneyImportPlatform, string[]][] = [
  ["taobao", ["订单号", "订单提交时间", "订单状态", "商品名称", "实付金额"]],
  ["meituan", ["交易创建时间", "交易类型", "订单标题", "实付金额"]],
  ["jd", ["商户名称", "交易说明", "交易订单号", "交易状态"]],
  ["wechat", ["交易单号", "当前状态", "商品", "收/支"]],
  ["alipay", ["交易订单号", "交易对方", "商品说明", "交易状态"]]
];

export function parseMoneyStatement(input: { format: MoneyImportFormat; content: string; timeZone: string; platform?: MoneyImportPlatform }): MoneyImportCandidate[] {
  const rows = input.format === "json" ? jsonRows(input.content) : input.format === "markdown" ? markdownRows(input.content) : csvRows(input.content);
  if (rows.length === 0) throw new Error("Statement contains no transaction rows.");
  if (rows.length > 500) throw new Error("Statement exceeds the 500-row review limit.");
  const platform = input.platform ?? detectPlatform(Object.keys(rows[0]!));
  if (platform === "taobao") return taobaoCandidates(rows, input.timeZone);
  return rows.map(row => platform === "generic" ? genericCandidate(row, input.timeZone) : platformCandidate(row, input.timeZone, platform));
}

export function applyMoneyImportRules(candidates: readonly MoneyImportCandidate[], rules: readonly MoneyImportRule[]): MoneyImportCandidate[] {
  return candidates.map(candidate => {
    const counterparty = candidate.proposed.counterparty?.trim().toLocaleLowerCase();
    if (!counterparty) return { ...candidate };
    const matching = rules.filter(rule => rule.matchValue.trim().toLocaleLowerCase() === counterparty);
    if (!matching.length) return { ...candidate };
    const proposed = { ...candidate.proposed };
    for (const rule of matching) {
      // Rules classify merchants, never change source amounts, dates, currency or refund direction.
      for (const key of ["counterparty", "category", "payment_method"] as const) if (rule.replacements[key] !== undefined) proposed[key] = rule.replacements[key];
      if (candidate.identityKind !== "refund" && candidate.proposed.entry_type !== "refund" && rule.replacements.entry_type !== "refund" && rule.replacements.entry_type !== undefined) proposed.entry_type = rule.replacements.entry_type;
    }
    return { ...candidate, proposed, warnings: [...candidate.warnings, "import_rule_applied"], appliedRuleIds: matching.map(rule => rule.id) };
  });
}

function genericCandidate(raw: Record<string, unknown>, timeZone: string): MoneyImportCandidate {
  const text = normalizedEntries(raw), issues: string[] = [], warnings: string[] = [], proposed: MoneyImportCandidate["proposed"] = { time_zone: timeZone, currency: "CNY" };
  const externalId = pick(text, aliases.externalId);
  const occurred = pick(text, aliases.occurredOn), date = occurred ? normalizeDate(occurred, timeZone) : undefined;
  if (!occurred) issues.push("missing_date"); else if (!date) issues.push("invalid_date"); else { proposed.occurred_on = date; if (/[ T].*(?:Z|[+-]\d{2}:?\d{2})$/u.test(occurred)) warnings.push("timestamp_date_in_requested_time_zone"); }
  const amountText = pick(text, aliases.amount), amount = amountText ? normalizeAmount(amountText) : undefined;
  if (!amountText) issues.push("missing_amount"); else if (!amount) issues.push("invalid_amount"); else proposed.amount = amount.value;
  const typeText = pick(text, aliases.entryType), entryType = typeText ? normalizeType(typeText) : undefined;
  if (typeText && !entryType) issues.push("invalid_entry_type"); else if (entryType) proposed.entry_type = entryType; else if (amount?.negative) { proposed.entry_type = "expense"; warnings.push("type_inferred_from_negative_amount"); } else issues.push("missing_entry_type");
  const currency = pick(text, aliases.currency); if (currency && !["CNY", "RMB", "人民币"].includes(currency.trim().toUpperCase())) issues.push("unsupported_currency");
  const counterparty = pick(text, aliases.counterparty), category = pick(text, aliases.category), method = pick(text, aliases.paymentMethod), note = pick(text, aliases.note);
  if (counterparty) proposed.counterparty = counterparty;
  if (category) proposed.category = category;
  if (method) { const paymentMethod = normalizePaymentMethod(method); if (paymentMethod) proposed.payment_method = paymentMethod; else warnings.push("unmapped_payment_method"); }
  if (note) proposed.note = note;
  return { raw, platform: "generic", ...(externalId ? { externalId } : {}), ...(proposed.entry_type ? { identityKind: proposed.entry_type } : {}), proposed, issues, warnings };
}

function platformCandidate(raw: Record<string, unknown>, timeZone: string, platform: Exclude<MoneyImportPlatform, "generic" | "taobao">): MoneyImportCandidate {
  const text = normalizedEntries(raw), value = (...names: string[]) => pick(text, names);
  const status = value("交易状态", "当前状态"), sourceType = value("交易类型"), direction = value("收/支", "收支");
  const refund = /退款/u.test(sourceType ?? "") || (direction !== "支出" && /^(?:退款成功|已退款|已全额退款)$/u.test(status ?? ""));
  let entryType: MoneyImportEntryType | undefined = refund ? "refund" : direction ? normalizeType(direction) : undefined;
  if (platform === "jd" && status === "交易成功" && (!direction || direction === "不计收支")) entryType = "expense";
  if (platform === "meituan" && !entryType && sourceType && /^(?:支付|付款|消费)$/u.test(sourceType)) entryType = "expense";
  // A successful payment whose status later contains a refund remains the original expense.
  if (direction === "支出" && /退款/u.test(status ?? "") && !/退款/u.test(sourceType ?? "")) entryType = "expense";
  const occurred = platform === "meituan" ? value("交易成功时间", "交易创建时间") : value(...aliases.occurredOn);
  const originalAmount = platform === "meituan" ? value("实付金额", "订单金额") : value(...aliases.amount);
  const amount = platform === "jd" ? originalAmount?.replace(/[（(](?:已全额退款|已部分退款)[）)]$/u, "") : originalAmount;
  const idNames = refund ? ["退款单号", "退款交易号", "交易单号", "交易订单号", "交易号"] : ["交易单号", "交易订单号", "交易号"];
  const externalId = value(...idNames);
  const result = genericCandidate({ date: occurred, amount, type: entryType ?? direction ?? sourceType, transaction_id: externalId, merchant: value(...aliases.counterparty), category: value(...aliases.category), payment_method: value(...aliases.paymentMethod), currency: value(...aliases.currency), note: [value("订单标题", "交易说明", "商品", "商品说明"), value("备注", "note", "memo")].filter(Boolean).join("；") }, timeZone);
  result.platform = platform;
  result.raw = { platform, rows: [raw] };
  if (status && !["交易成功", "支付成功", "退款成功", "支付完成", "已支付", "对方已收钱", "已收钱", "已存入零钱", "已转账"].includes(status) && !/^已(?:全额)?退款(?:[（(].*[）)])?$/u.test(status)) result.issues.push("non_completed_transaction");
  if ((platform === "jd" || platform === "alipay" || platform === "wechat") && !status) result.issues.push("missing_transaction_status");
  if (platform === "meituan" && !value("交易成功时间") && !["交易成功", "支付成功", "退款成功", "已支付"].includes(status ?? "")) result.issues.push("unsettled_transaction");
  if (result.proposed.entry_type === "refund") result.warnings.push("refund_unlinked");
  if (!externalId) result.warnings.push("missing_stable_external_id");
  if (direction === "不计收支") result.warnings.push("platform_excluded_from_balance");
  if (amount !== originalAmount) result.warnings.push("source_amount_annotation");
  if (result.proposed.entry_type === "expense" && /退款/u.test(status ?? "")) result.warnings.push("refund_status_is_not_refund_event");
  return result;
}

function taobaoCandidates(rows: Record<string, unknown>[], timeZone: string): MoneyImportCandidate[] {
  const groups: Record<string, unknown>[][] = [];
  let current: Record<string, unknown>[] | undefined;
  for (const row of rows) {
    const values = normalizedEntries(row);
    if (pick(values, ["订单号"])) { current = [row]; groups.push(current); }
    else if (current && !pick(values, ["订单提交时间", "订单状态", "实付金额"])) current.push(row);
    else { current = undefined; groups.push([row]); }
  }
  return groups.map(group => {
    const order = group[0]!, text = normalizedEntries(order), value = (...names: string[]) => pick(text, names), status = value("订单状态");
    const items = group.map(row => {
      const fields = normalizedEntries(row), item: Record<string, string> = {};
      for (const [key, field] of [["name", "商品名称"], ["quantity", "商品数量"], ["amount", "商品金额"], ["variant", "型号款式"], ["url", "商品链接"]]) {
        const found = pick(fields, [field!]); if (found) item[key!] = found;
      }
      return item;
    });
    const result = genericCandidate({ transaction_id: value("订单号"), date: value("订单提交时间"), type: "expense", amount: value("实付金额"), merchant: value("店铺名称"), payment_method: value("支付方式"), currency: value(...aliases.currency), note: items.map(item => item.name).filter(Boolean).join("；") }, timeZone);
    result.platform = "taobao";
    result.raw = { platform: "taobao", rows: group, items };
    if (!value("订单号")) { result.issues.push("orphan_order_item"); result.warnings.push("missing_stable_external_id"); }
    if (!["交易成功", "充值成功"].includes(status ?? "")) result.issues.push("non_completed_transaction");
    result.warnings.push("order_paid_total_used");
    return result;
  });
}

function normalizedEntries(row: Record<string, unknown>): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    const text = typeof value === "string" ? value.trim() : String(value);
    if (text && !["/", "-", "--"].includes(text)) result.set(normalizeHeader(key), text);
  }
  return result;
}
function pick(row: Map<string, string>, names: readonly string[]): string | undefined { for (const name of names) { const value = row.get(normalizeHeader(name)); if (value) return value; } return undefined; }
function normalizeHeader(value: string): string { return value.trim().toLocaleLowerCase().replace(/[\s_-]+/gu, ""); }
function detectPlatform(headers: string[]): MoneyImportPlatform {
  const names = new Set(headers.map(normalizeHeader));
  return platformHeaders.find(([, required]) => required.every(name => names.has(normalizeHeader(name))))?.[0] ?? "generic";
}
function normalizeDate(value: string, timeZone: string): string | undefined {
  const match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:$|[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$)/u.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]), date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  const time = /[ T](\d{2}):(\d{2})(?::(\d{2}))?/u.exec(value);
  if (time && (Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] ?? 0) > 59)) return undefined;
  const dateOnly = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const offset = /(?:Z|[+-]\d{2}:?\d{2})$/u.exec(value.trim())?.[0];
  if (time && offset) {
    const timestamp = Date.parse(`${dateOnly}T${time[1]}:${time[2]}:${time[3] ?? "00"}${offset}`);
    if (!Number.isFinite(timestamp)) return undefined;
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
  }
  // A local or date-only export has no instant. Never invent one using the machine's timezone.
  return dateOnly;
}
function normalizeAmount(value: string): { value: string; negative: boolean } | undefined {
  let text = value.trim().replace(/^[￥¥]\s*/u, ""), negative = false;
  if (text.startsWith("(") && text.endsWith(")")) { negative = true; text = text.slice(1, -1); }
  if (text.startsWith("-")) { negative = true; text = text.slice(1); }
  if (text.startsWith("+")) text = text.slice(1);
  if (!/^(?:\d+|\d{1,3}(?:[,，]\d{3})+)(?:\.\d{1,2})?$/u.test(text)) return undefined;
  text = text.replace(/[,，]/gu, "");
  const [wholeRaw, fractionRaw = ""] = text.split("."), whole = wholeRaw!.replace(/^0+(?=\d)/u, "");
  if (whole.length > 18) return undefined;
  const canonical = `${whole}.${fractionRaw.padEnd(2, "0")}`;
  if (canonical === "0.00") return undefined;
  return { value: canonical, negative };
}
function normalizeType(value: string): MoneyImportEntryType | undefined {
  const key = value.trim().toLocaleLowerCase().replace(/\s+/gu, "");
  if (["expense", "支出", "消费", "付款", "支付", "debit", "out"].includes(key)) return "expense";
  if (["income", "收入", "入账", "credit", "in"].includes(key)) return "income";
  if (["refund", "退款", "退货退款"].includes(key)) return "refund";
  return undefined;
}
function normalizePaymentMethod(value: string): string | undefined {
  const key = value.trim().toLocaleLowerCase().replace(/\s+/gu, "");
  return ({ 支付宝: "alipay", alipay: "alipay", 微信: "wechat", 微信支付: "wechat", wechat: "wechat", 现金: "cash", cash: "cash", 银行卡: "bank_card", bankcard: "bank_card", 银行转账: "bank_transfer", banktransfer: "bank_transfer", 京东支付: "jd_pay", 京东白条: "jd_baitiao", 花呗: "huabei", 礼品卡: "gift_card", 混合支付: "mixed", 其他: "other" } as Record<string, string>)[key];
}

function jsonRows(content: string): Record<string, unknown>[] {
  let value: unknown;
  try {
    // Node 24 exposes the original primitive token. Keeping numeric tokens as strings avoids rounding
    // 20-digit platform identifiers or amounts before validation, without interpreting exponent IDs.
    value = JSON.parse(content.replace(/^\uFEFF/u, ""), (key: string, item: unknown, context?: { source?: string }) => {
      if (typeof item !== "number") return item;
      if (!context?.source) throw new Error("Numeric statement tokens require a runtime with lossless JSON source support.");
      if ([...aliases.externalId, "商家订单号", "商家单号", "退款单号", "退款交易号"].some(name => normalizeHeader(name) === normalizeHeader(key)) && !/^\d+$/u.test(context.source)) throw new Error("Numeric transaction identifiers must use decimal integer tokens or quoted strings.");
      return context.source;
    });
  } catch (error) { throw new Error(error instanceof SyntaxError ? "Statement JSON is invalid." : error instanceof Error ? error.message : "Statement JSON is invalid."); }
  const rows = Array.isArray(value) ? value : value !== null && typeof value === "object" && Array.isArray((value as { transactions?: unknown }).transactions) ? (value as { transactions: unknown[] }).transactions : undefined;
  if (!rows) throw new Error("Statement JSON must be an array or contain a transactions array.");
  return rows.map((row, index) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error(`Statement JSON row ${index + 1} is not an object.`);
    const object = row as Record<string, unknown>, keys = Object.keys(object).map(normalizeHeader);
    if (new Set(keys).size !== keys.length) throw new Error(`Statement JSON row ${index + 1} contains duplicate normalized headers.`);
    return object;
  });
}
function csvRows(content: string): Record<string, unknown>[] {
  const rows = parseCsvCells(content.replace(/^\uFEFF/u, ""));
  if (rows.length < 2) return [];
  const knownHeaders = new Set([...Object.values(aliases).flat(), ...platformHeaders.flatMap(([, headers]) => headers), "订单金额", "实付金额"].map(normalizeHeader));
  const headerIndex = rows.findIndex(row => row.filter(cell => knownHeaders.has(normalizeHeader(cell))).length >= 2);
  const start = headerIndex < 0 ? 0 : headerIndex, headers = rows[start]!.map(value => value.trim());
  // Some exports append delimiters to every row; only empty trailing columns can be discarded.
  while (headers.length && !headers.at(-1)) headers.pop();
  validateHeaders(headers, "CSV");
  return tableRows(headers, rows.slice(start + 1).map(row => row.length > headers.length && row.slice(headers.length).every(cell => !cell.trim()) ? row.slice(0, headers.length) : row), "CSV");
}
function validateHeaders(headers: string[], format: string): void {
  if (!headers.length || headers.some(value => !value)) throw new Error(`Statement ${format} contains an empty header.`);
  if (new Set(headers.map(normalizeHeader)).size !== headers.length) throw new Error(`Statement ${format} contains duplicate headers.`);
}
function tableRows(headers: string[], rows: string[][], format: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  let footer = false;
  for (const [index, row] of rows.entries()) {
    if (row.every(value => !value.trim())) continue;
    const populated = row.filter(value => value.trim());
    const isFooter = /^(?:[-=＊*]{3,}|(?:共\s*\d+\s*笔|合计|统计|收入\s*[:：]|支出\s*[:：]|导出时间|账单导出时间|注[:：]|说明[:：]))/u.test(populated[0]?.trim() ?? "");
    if (isFooter && (populated.length <= 2 || row.length !== headers.length)) { footer = true; continue; }
    if (footer) throw new Error(`Statement ${format} has a transaction after its summary footer.`);
    if (row.length !== headers.length) throw new Error(`Statement ${format} row ${index + 1} has ${row.length} cells; expected ${headers.length}.`);
    result.push(Object.fromEntries(headers.map((header, position) => [header, row[position]!.trim()])));
  }
  return result;
}
function parseCsvCells(content: string): string[][] {
  const rows: string[][] = [], row: string[] = [];
  let cell = "", quoted = false, closedQuote = false;
  const pushCell = () => { row.push(cell); cell = ""; closedQuote = false; };
  const pushRow = () => { pushCell(); rows.push([...row]); row.length = 0; };
  for (let index = 0; index < content.length; index++) {
    const char = content[index]!;
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else cell += char;
      continue;
    }
    if (char === ",") pushCell();
    else if (char === "\n" || char === "\r") { if (char === "\r" && content[index + 1] === "\n") index++; pushRow(); }
    else if (char === '"') { if (cell.length || closedQuote) throw new Error("Statement CSV has an unexpected quote."); quoted = true; }
    else if (closedQuote) { if (!/\s/u.test(char)) throw new Error("Statement CSV has text after a closing quote."); }
    else cell += char;
  }
  if (quoted) throw new Error("Statement CSV has an unclosed quote.");
  if (cell.length || row.length || closedQuote) pushRow();
  return rows;
}
function markdownRows(content: string): Record<string, unknown>[] {
  const lines = content.replace(/^\uFEFF/u, "").split(/\r?\n/u).map(line => line.trim());
  const cells = (line: string) => line.replace(/^\||\|$/gu, "").split(/(?<!\\)\|/u).map(value => value.replaceAll("\\|", "|").trim());
  const start = lines.findIndex((line, index) => line.includes("|") && lines[index + 1]?.includes("|") && cells(lines[index + 1]!).every(value => /^:?-{3,}:?$/u.test(value)));
  if (start < 0) throw new Error("Statement Markdown needs a table separator row.");
  const headers = cells(lines[start]!);
  validateHeaders(headers, "Markdown");
  if (cells(lines[start + 1]!).length !== headers.length) throw new Error("Statement Markdown separator width does not match its headers.");
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) { if (!line.includes("|")) { if (line && rows.length) break; continue; } rows.push(cells(line)); }
  return tableRows(headers, rows, "Markdown");
}

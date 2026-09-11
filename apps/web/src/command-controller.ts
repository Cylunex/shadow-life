import type { ExecutionResult, WriteCapabilityName } from "@shadow/contracts";

export type Execute = (capability: WriteCapabilityName, input: unknown, scope: string) => Promise<ExecutionResult>;

type CommandState = "pending" | "unknown" | "committed" | "failed";
type StoredCommand = {
  version: 1;
  capability: WriteCapabilityName;
  inputHash: string;
  commandId: string;
  state: CommandState;
  result?: ExecutionResult;
};

export interface CommandStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class CommandController {
  private readonly delivered = new Set<string>();
  private readonly inFlight = new Map<string, Promise<ExecutionResult>>();
  constructor(
    private readonly fetcher: typeof fetch,
    private readonly headers: () => HeadersInit,
    private readonly storage: CommandStorage,
    private readonly namespace = "shadow-life:web-command:v1",
  ) {}

  readonly execute: Execute = (capability, input, scope) => {
    const key = `${this.namespace}:${scope}`;
    const running=this.inFlight.get(key);
    if(running)return running;
    const operation=this.executeOne(capability,input,key).finally(()=>this.inFlight.delete(key));
    this.inFlight.set(key,operation);
    return operation;
  };

  private async executeOne(capability:WriteCapabilityName,input:unknown,key:string):Promise<ExecutionResult> {
    const inputHash = stableJson(input);
    let previous = this.read(key);

    if (previous?.state === "committed" && previous.capability === capability && previous.inputHash === inputHash && previous.result) {
      if(!this.delivered.has(key)){
        const recovered=await this.recover(previous,key);
        if(recovered){this.delivered.add(key);return recovered;}
        previous=this.read(key);
      }
    }

    if (previous && (previous.state === "pending" || previous.state === "unknown")) {
      const recovered = await this.recover(previous, key);
      if (recovered && previous.capability === capability && previous.inputHash === inputHash){this.delivered.add(key);return recovered;}
      previous = this.read(key);
    }

    if (previous && (previous.state === "pending" || previous.state === "unknown")) {
      throw new Error("上一笔操作的结果仍无法确认，请恢复网络后重试；为避免重复写入，暂未创建新操作。");
    }

    const command: StoredCommand = {
      version: 1,
      capability,
      inputHash,
      commandId: `cmd_web_${crypto.randomUUID()}`,
      state: "pending",
    };
    this.write(key, command);
    const result=await this.submit(command, input, key);
    this.delivered.add(key);
    return result;
  }

  private async recover(command: StoredCommand, key: string): Promise<ExecutionResult | undefined> {
    let response: Response;
    try {
      response = await this.fetcher(`/api/operations/by-command/${encodeURIComponent(command.commandId)}`, { headers: this.headers() });
    } catch {
      this.write(key, { ...command, state: "unknown" });
      throw new Error("网络不可用，上一笔操作的结果仍未知；请恢复网络后重试。");
    }
    if (response.ok) {
      const result = await response.json() as ExecutionResult;
      this.write(key, { ...command, state: "committed", result });
      return result;
    }
    if (response.status === 404) {
      this.write(key, { ...command, state: "failed" });
      return undefined;
    }
    this.write(key, { ...command, state: "unknown" });
    throw new Error(await responseMessage(response, "暂时无法确认上一笔操作是否成功。"));
  }

  private async submit(command: StoredCommand, input: unknown, key: string): Promise<ExecutionResult> {
    let response: Response;
    try {
      response = await this.fetcher(`/api/commands/${command.capability}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ protocol: "shadow.command", capability: command.capability, command_id: command.commandId, input }),
      });
    } catch {
      this.write(key, { ...command, state: "unknown" });
      throw new Error("提交后连接中断，结果尚未确认；再次点击会先查询原操作，不会重复写入。");
    }
    if (!response.ok) {
      const value = await response.clone().json().catch(() => undefined) as { code?: string; message?: string } | undefined;
      const state: CommandState = value?.code === "outcome_unknown" ? "unknown" : "failed";
      this.write(key, { ...command, state });
      throw new Error(value?.message ?? `保存失败（HTTP ${response.status}）`);
    }
    const result = await response.json() as ExecutionResult;
    this.write(key, { ...command, state: "committed", result });
    return result;
  }

  private read(key: string): StoredCommand | undefined {
    let raw:string|null;
    try{raw=this.storage.getItem(key);}catch{throw new Error("浏览器无法读取安全重试状态；为避免重复写入，本次没有提交。");}
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as StoredCommand;
      return value.version === 1 && typeof value.commandId === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private write(key: string, value: StoredCommand): void {
    try{this.storage.setItem(key, JSON.stringify(value));}catch{throw new Error("浏览器无法保存安全重试状态；为避免重复写入，本次没有提交。");}
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const value = await response.json().catch(() => undefined) as { message?: string } | undefined;
  return value?.message ?? fallback;
}

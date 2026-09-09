import { readFile } from "node:fs/promises";

const [group, action, argument, option] = process.argv.slice(2);
const baseUrl = (process.env.SHADOW_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/u, "");
const token = process.env.SHADOW_ACCESS_TOKEN;
if (token === undefined) throw new Error("SHADOW_ACCESS_TOKEN is required");
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

let response: Response;
if (group === "capabilities" && action === "search") {
  response = await fetch(`${baseUrl}/api/capabilities`, { headers });
} else if (group === "schema" && action !== undefined) {
  response = await fetch(`${baseUrl}/api/capabilities/${encodeURIComponent(action)}`, { headers });
} else if (group === "life" && action === "record-meal" && argument !== undefined) {
  response = await fetch(`${baseUrl}/api/commands/life.record_meal`, { method: "POST", headers, body: await readFile(argument, "utf8") });
} else if (group === "command" && action !== undefined && argument !== undefined) {
  response = await fetch(`${baseUrl}/api/commands/${encodeURIComponent(action)}`, { method: "POST", headers, body: await readFile(argument, "utf8") });
} else if (group === "operation" && action === "get" && argument !== undefined) {
  response = await fetch(`${baseUrl}/api/operations/${encodeURIComponent(argument)}`, { headers });
} else if (group === "operation" && action === "find" && argument !== undefined) {
  response = await fetch(`${baseUrl}/api/operations/by-command/${encodeURIComponent(argument)}`, { headers });
} else if (group === "life" && action === "meals") {
  response = await fetch(`${baseUrl}/api/meals`, { headers });
} else if (group === "money" && action === "summary") {
  response = await fetch(`${baseUrl}/api/money/summary`, { headers });
} else if(group==="money"&&action==="planning"){
  response=await fetch(`${baseUrl}/api/money/planning${argument?`?period=${encodeURIComponent(argument)}`:""}`,{headers});
} else if(group==="life"&&action==="get"&&argument){response=await fetch(`${baseUrl}/api/life/records/${encodeURIComponent(argument)}${option?`?sections=${encodeURIComponent(option)}`:""}`,{headers});
} else if(group==="health"&&action==="daily"&&argument){response=await fetch(`${baseUrl}/api/health/daily/${encodeURIComponent(argument)}`,{headers});
} else if(group==="travel"&&action==="get"&&argument){response=await fetch(`${baseUrl}/api/travel/trips/${encodeURIComponent(argument)}`,{headers});
} else if(group==="library"&&action==="get"&&argument){response=await fetch(`${baseUrl}/api/library/items/${encodeURIComponent(argument)}`,{headers});
} else {
  console.error("Usage: shadow capabilities search | schema <name> | command <capability> <json> | life record-meal <json> | life meals | life get <id> [meal,purchase,money,sources] | money summary | money planning [YYYY-MM] | health daily <date> | travel get <trip-id> | library get <item-id> | operation get <execution-id> | operation find <command-id>");
  process.exit(64);
}
const body = await response.text();
process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
if (!response.ok) process.exit(response.status === 401 || response.status === 403 ? 77 : response.status === 409 ? 75 : 65);

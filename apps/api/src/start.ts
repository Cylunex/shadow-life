import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { AgentRepository, PostgresUnitOfWork } from "@shadow/database";
import { HttpRuntimeAdapter, UnavailableRuntimeAdapter } from "@shadow/agent-adapter";
import { CommandExecutor, QueryService, sha256Fingerprinter, systemClock, uuidIds } from "@shadow/kernel";
import { projectDirectoryResultSchema, type ProjectDirectoryResult } from "@shadow/contracts";
import { createApp } from "./app.js";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) throw new Error("DATABASE_URL is required");
const unitOfWork = new PostgresUnitOfWork({ connectionString });
const executor = new CommandExecutor({ unitOfWork, ids: uuidIds, clock: systemClock, fingerprinter: sha256Fingerprinter });
const runtime = process.env.SHADOW_RUNTIME_URL ? new HttpRuntimeAdapter({ url: process.env.SHADOW_RUNTIME_URL, ...(process.env.SHADOW_RUNTIME_TOKEN ? { token: process.env.SHADOW_RUNTIME_TOKEN } : {}) }) : new UnavailableRuntimeAdapter();
function identitySubjects(value:string|undefined):Record<string,string>|undefined{if(!value)return undefined;const parsed=JSON.parse(value) as unknown;if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("SHADOW_IDENTITY_SUBJECTS must be a JSON object");const entries=Object.entries(parsed as Record<string,unknown>);if(entries.some(([key,item])=>!key||typeof item!=="string"||!/^[a-z][a-z0-9_]{7,127}$/u.test(item)))throw new Error("SHADOW_IDENTITY_SUBJECTS contains an invalid mapping");return Object.fromEntries(entries) as Record<string,string>;}
const subjectMap=identitySubjects(process.env.SHADOW_IDENTITY_SUBJECTS);
const auth=process.env.SHADOW_OIDC_ISSUER&&process.env.SHADOW_OIDC_AUDIENCE&&process.env.SHADOW_OIDC_JWKS_URL?{issuer:process.env.SHADOW_OIDC_ISSUER,audience:process.env.SHADOW_OIDC_AUDIENCE,jwksUrl:process.env.SHADOW_OIDC_JWKS_URL,environmentId:process.env.SHADOW_ENVIRONMENT_ID??"default",...(process.env.SHADOW_OIDC_ALLOWED_CLIENTS?{allowedClients:process.env.SHADOW_OIDC_ALLOWED_CLIENTS.split(",").map(value=>value.trim()).filter(Boolean)}:{}),...(subjectMap?{identitySubjects:subjectMap}:{}),...(process.env.SHADOW_WEB_ORIGIN?{webOrigin:process.env.SHADOW_WEB_ORIGIN}:{})}:undefined;
const proxyAuth=process.env.SHADOW_PROXY_AUTH_SECRET&&process.env.SHADOW_PROXY_SUBJECT_ID?{secret:process.env.SHADOW_PROXY_AUTH_SECRET,subjectId:process.env.SHADOW_PROXY_SUBJECT_ID}:undefined;
const webSession=process.env.SHADOW_OIDC_AUTHORIZATION_URL&&process.env.SHADOW_OIDC_TOKEN_URL&&process.env.SHADOW_OIDC_CLIENT_ID&&process.env.SHADOW_OIDC_REDIRECT_URI&&process.env.SHADOW_WEB_ORIGIN&&process.env.SHADOW_SESSION_SECRET?{authorizationUrl:process.env.SHADOW_OIDC_AUTHORIZATION_URL,tokenUrl:process.env.SHADOW_OIDC_TOKEN_URL,clientId:process.env.SHADOW_OIDC_CLIENT_ID,redirectUri:process.env.SHADOW_OIDC_REDIRECT_URI,webOrigin:process.env.SHADOW_WEB_ORIGIN,sessionSecret:process.env.SHADOW_SESSION_SECRET,...(process.env.SHADOW_OIDC_CLIENT_SECRET?{clientSecret:process.env.SHADOW_OIDC_CLIENT_SECRET}:{})}:undefined;
function projectLinks(value:string|undefined,file:string|undefined):ProjectDirectoryResult{if(value&&file)throw new Error("Configure only one of SHADOW_PROJECT_LINKS or SHADOW_PROJECT_LINKS_FILE");const raw=file?readFileSync(file,"utf8"):value;if(raw===undefined)return projectDirectoryResultSchema.parse({schema_version:1,catalog_revision:"unconfigured",items:[{id:"shadow-foliant",title:"股票研究",subtitle:"Shadow Foliant · 独立应用",icon:"chart-line",state:"not_configured",auth_hint:"project_managed",order:10},{id:"shadow-garden",title:"博客创作",subtitle:"Shadow Garden · 独立应用",icon:"notebook-pen",state:"not_configured",auth_hint:"project_managed",order:20}]});let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new Error("Shadow project directory must be valid JSON");}return projectDirectoryResultSchema.parse(parsed);}
const configuredProjectLinks=projectLinks(process.env.SHADOW_PROJECT_LINKS,process.env.SHADOW_PROJECT_LINKS_FILE);
if(process.env.NODE_ENV==="production"&&!proxyAuth&&(!auth||!webSession||!subjectMap||!auth.allowedClients?.length))throw new Error("Production requires complete OIDC, client allowlist and subject mapping settings or trusted proxy auth settings");
const app = createApp({ unitOfWork, executor, queries: new QueryService(unitOfWork), developmentAuth: process.env.SHADOW_DEV_AUTH === "true",projectLinks:configuredProjectLinks,...((auth||proxyAuth)?{auth:{...auth,...(proxyAuth?{proxyAuth}:{})}}:{}),...(webSession?{webSession}:{}), agent: { repository: new AgentRepository(unitOfWork.pool), runtime, nextId: (type) => uuidIds.next(type) } });
const port = Number(process.env.PORT ?? "8787");
const hostname=process.env.HOST??"127.0.0.1";
serve({ fetch: app.fetch, port, hostname }, (info) => console.log(`Shadow API listening on http://${hostname}:${info.port}`));

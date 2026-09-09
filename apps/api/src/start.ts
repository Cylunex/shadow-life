import { serve } from "@hono/node-server";
import { AgentRepository, PostgresUnitOfWork } from "@shadow/database";
import { HttpRuntimeAdapter, UnavailableRuntimeAdapter } from "@shadow/agent-adapter";
import { CommandExecutor, QueryService, sha256Fingerprinter, systemClock, uuidIds } from "@shadow/kernel";
import { createApp } from "./app.js";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) throw new Error("DATABASE_URL is required");
const unitOfWork = new PostgresUnitOfWork({ connectionString });
const executor = new CommandExecutor({ unitOfWork, ids: uuidIds, clock: systemClock, fingerprinter: sha256Fingerprinter });
const runtime = process.env.SHADOW_RUNTIME_URL ? new HttpRuntimeAdapter({ url: process.env.SHADOW_RUNTIME_URL, ...(process.env.SHADOW_RUNTIME_TOKEN ? { token: process.env.SHADOW_RUNTIME_TOKEN } : {}) }) : new UnavailableRuntimeAdapter();
const auth=process.env.SHADOW_OIDC_ISSUER&&process.env.SHADOW_OIDC_AUDIENCE&&process.env.SHADOW_OIDC_JWKS_URL?{issuer:process.env.SHADOW_OIDC_ISSUER,audience:process.env.SHADOW_OIDC_AUDIENCE,jwksUrl:process.env.SHADOW_OIDC_JWKS_URL,...(process.env.SHADOW_WEB_ORIGIN?{webOrigin:process.env.SHADOW_WEB_ORIGIN}:{})}:undefined;
const webSession=process.env.SHADOW_OIDC_AUTHORIZATION_URL&&process.env.SHADOW_OIDC_TOKEN_URL&&process.env.SHADOW_OIDC_CLIENT_ID&&process.env.SHADOW_OIDC_REDIRECT_URI&&process.env.SHADOW_WEB_ORIGIN&&process.env.SHADOW_SESSION_SECRET?{authorizationUrl:process.env.SHADOW_OIDC_AUTHORIZATION_URL,tokenUrl:process.env.SHADOW_OIDC_TOKEN_URL,clientId:process.env.SHADOW_OIDC_CLIENT_ID,redirectUri:process.env.SHADOW_OIDC_REDIRECT_URI,webOrigin:process.env.SHADOW_WEB_ORIGIN,sessionSecret:process.env.SHADOW_SESSION_SECRET,...(process.env.SHADOW_OIDC_CLIENT_SECRET?{clientSecret:process.env.SHADOW_OIDC_CLIENT_SECRET}:{})}:undefined;
if(process.env.NODE_ENV==="production"&&(!auth||!webSession))throw new Error("Production requires complete SHADOW_OIDC_* settings, SHADOW_WEB_ORIGIN and SHADOW_SESSION_SECRET");
const app = createApp({ unitOfWork, executor, queries: new QueryService(unitOfWork), developmentAuth: process.env.SHADOW_DEV_AUTH === "true",...(auth?{auth}:{}),...(webSession?{webSession}:{}), agent: { repository: new AgentRepository(unitOfWork.pool), runtime, nextId: (type) => uuidIds.next(type) } });
const port = Number(process.env.PORT ?? "8787");
serve({ fetch: app.fetch, port }, (info) => console.log(`Shadow API listening on http://127.0.0.1:${info.port}`));

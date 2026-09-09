import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { authMiddleware } from "../src/auth.js";
import { installWebSessionRoutes } from "../src/web-session.js";

test("web login establishes a signed PKCE transaction",async()=>{
  const app=new Hono();installWebSessionRoutes(app,{authorizationUrl:"https://id.example.com/authorize",tokenUrl:"https://id.example.com/token",clientId:"shadow-life",redirectUri:"https://life.example.com/auth/callback",webOrigin:"https://life.example.com",sessionSecret:"test-secret-with-enough-entropy"});
  const response=await app.request("/auth/login");assert.equal(response.status,302);const location=new URL(response.headers.get("location")!);assert.equal(location.origin,"https://id.example.com");assert.equal(location.searchParams.get("code_challenge_method"),"S256");assert.ok(location.searchParams.get("state"));assert.ok(location.searchParams.get("code_challenge"));const cookies=response.headers.get("set-cookie")??"";assert.match(cookies,/shadow_oidc_state=/u);assert.match(cookies,/HttpOnly/u);assert.match(cookies,/Secure/u);
  assert.equal((await app.request("/auth/callback?code=forged&state=forged")).status,401);
});

test("cookie writes require the configured same origin",async()=>{
  const app=new Hono();app.use("/api/*",authMiddleware({development:false,issuer:"https://id.example.com",audience:"life",jwksUrl:"https://id.example.com/jwks",webOrigin:"https://life.example.com"}));app.post("/api/write",context=>context.text("ok"));
  const response=await app.request("/api/write",{method:"POST",headers:{cookie:"shadow_access_token=fake",origin:"https://evil.example.com"}});assert.equal(response.status,403);assert.equal((await response.json() as {code:string}).code,"permission_denied");
});

test("client write epochs are parsed before execution",async()=>{const app=new Hono();app.use("/api/*",authMiddleware({development:true}));app.post("/api/write",context=>context.json(context.get("requestContext").writeEpochs));const ok=await app.request("/api/write",{method:"POST",headers:{authorization:"Bearer dev:subject_example","x-shadow-write-epochs":"health=3,ledger=7"}});assert.deepEqual(await ok.json(),{health:3,ledger:7});assert.equal((await app.request("/api/write",{method:"POST",headers:{authorization:"Bearer dev:subject_example","x-shadow-write-epochs":"ledger=old"}})).status,422);});

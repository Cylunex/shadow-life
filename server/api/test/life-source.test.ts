import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";

test("trusted proxy and mapped OIDC subjects bind to the configured issuer, environment and Life subject", async () => {
  const issuer = "https://identity.example.com/tenant", subject = "subject_source_test", secret = "a".repeat(40);
  const deps = { developmentAuth: true, auth: { issuer, environmentId: "测试空间", proxyAuth: { secret, subjectId: subject } },
    unitOfWork: { pool: {} }, executor: {}, queries: {} } as unknown as Parameters<typeof createApp>[0];
  const app = createApp(deps);
  const response = await app.request("/api/source", { headers: { "x-shadow-proxy-secret": secret } });
  const scope = createHash("sha256").update(JSON.stringify(["shadow-life-source-v1", issuer, "测试空间", subject])).digest("hex");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { scope });
  assert.equal(response.headers.get("cache-control"), "no-store");
  for (const [headers, status] of [[{}, 401], [{ authorization: "Bearer dev:" + subject }, 403]] as const) {
    const refusal = await app.request("/api/source", { headers });
    assert.equal(refusal.status, status);
    assert.equal(refusal.headers.get("cache-control"), "no-store");
  }
  delete deps.auth!.issuer;
  assert.equal((await app.request("/api/source", { headers: { "x-shadow-proxy-secret": secret } })).status, 403);
});

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { LifeClient, ToolFailure } from "../src/client.js";
import { createMcpServer } from "../src/server.js";
import { uploadLocalImage } from "../src/media.js";

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const receipt = { protocol: "shadow.asset", asset_id: "asset_test0001", asset_version_id: "assetv_test0001", sha256: createHash("sha256").update(png).digest("hex"), bytes: png.length, media_type: "image/png" };

test("original image bytes reach API and immutable asset receipt is verified", async t => {
  const root = await mkdtemp(join(tmpdir(), "life-image-")); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "inbound.jpg"); await writeFile(path, png);
  let calls = 0;
  const client = new LifeClient({ api: "https://life.example.com", token: "test-token", profile: "personal", fetch: async (url, init) => {
    calls++; assert.equal(String(url), "https://life.example.com/api/assets"); assert.equal(new Headers(init?.headers).get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(init!.body as Uint8Array), png); return Response.json(receipt);
  } });
  assert.deepEqual(await uploadLocalImage(client, [root], { path }), receipt); assert.equal(calls, 1);
});

test("cache escape, symlink escape, directories, empty and non-raster files never upload", async t => {
  const root = await mkdtemp(join(tmpdir(), "life-image-")); t.after(() => rm(root, { recursive: true, force: true }));
  const cache = join(root, "cache"); await mkdir(cache); await writeFile(join(root, "outside.png"), png); await symlink(join(root, "outside.png"), join(cache, "link.png"));
  await writeFile(join(cache, "bad.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>'); await writeFile(join(cache, "empty.png"), "");
  const client = new LifeClient({ api: "https://life.example.com", token: "test-token", profile: "personal", fetch: async () => { assert.fail("forbidden file must never be uploaded"); } });
  for (const path of [join(root, "outside.png"), join(cache, "link.png"), cache, join(cache, "bad.svg"), join(cache, "empty.png")]) {
    await assert.rejects(uploadLocalImage(client, [cache], { path }), ToolFailure);
  }
});

test("20 MiB limit applies before reading or dispatching the image", async t => {
  const root = await mkdtemp(join(tmpdir(), "life-image-")); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "large.png"); await writeFile(path, Buffer.alloc(20 * 1024 * 1024 + 1));
  const client = new LifeClient({ api: "https://life.example.com", token: "test-token", profile: "personal", fetch: async () => { assert.fail("oversized image must never be uploaded"); } });
  await assert.rejects(uploadLocalImage(client, [root], { path }), ToolFailure);
});

test("mismatched uploaded image receipt is unknown, never reported as unsubmitted input", async t => {
  const root = await mkdtemp(join(tmpdir(), "life-image-")); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "image.png"); await writeFile(path, png);
  for (const body of [{ ...receipt, sha256: "0".repeat(64) }, { ok: true }]) {
    const client = new LifeClient({ api: "https://life.example.com", token: "test-token", profile: "personal", fetch: async () => Response.json(body) });
    const handler = createMcpServer(client, [root]);
    const response: any = await handler(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "assets.upload_local_image", arguments: { path } } }));
    assert.equal(response.result.isError, true); assert.equal(response.result.structuredContent.code, "outcome_unknown");
  }
});

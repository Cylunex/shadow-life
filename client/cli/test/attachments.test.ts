import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { LifeClient, ToolFailure } from "@shadow/life-client/client";
import { uploadLocalAttachment } from "@shadow/life-client/media";
import { runSkill } from "../src/skill.js";

const receipt = (bytes: Buffer, type: string) => ({ protocol: "shadow.asset", asset_id: "asset_attachment1", asset_version_id: "assetv_attachment1", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, media_type: type });

test("general file skill posts unchanged bytes to assets without creating business records", async t => {
  const root = await mkdtemp(join(tmpdir(), "life-attachment-")); t.after(() => rm(root, { recursive: true, force: true }));
  const calls: string[] = [], bytes = Buffer.from("synthetic general document");
  const server = createServer(async (req, res) => {
    assert.equal(req.headers["x-shadow-proxy-secret"], "synthetic-secret");
    assert.equal(req.headers["x-shadow-proxy-client-id"], "client_attachment_test");
    calls.push(req.url!); res.setHeader("content-type", "application/json");
    if (req.url!.startsWith("/api/capabilities")) { res.end(JSON.stringify({ capabilities: [] })); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), bytes);
    res.end(JSON.stringify(receipt(bytes, "application/pdf")));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const config = join(root, "config.json"), path = join(root, "notes.pdf");
  await writeFile(path, bytes);
  await writeFile(config, JSON.stringify({ api: `http://127.0.0.1:${(server.address() as {port: number}).port}`, proxySecret: "synthetic-secret", proxyClientId: "client_attachment_test", mediaRoots: [root] }));
  const tools = await runSkill(config, "catalog") as Array<{name: string}>;
  assert.ok(tools.some(tool => tool.name === "assets.upload_local_attachment"));
  assert.deepEqual(await runSkill(config, "call", "assets.upload_local_attachment", { path, media_type: "application/pdf" }), receipt(bytes, "application/pdf"));
  assert.deepEqual(calls, ["/api/capabilities?include_schemas=true", "/api/assets"]);
});

test("general attachment uploader rejects escaping, empty, oversized files and forged receipts", async t => {
  const root = await mkdtemp(join(tmpdir(), "life-attachment-")); t.after(() => rm(root, { recursive: true, force: true }));
  const cache = join(root, "cache"); await mkdir(cache);
  await writeFile(join(root, "outside.txt"), "outside"); await symlink(join(root, "outside.txt"), join(cache, "link.txt"));
  await writeFile(join(cache, "empty.txt"), ""); await writeFile(join(cache, "huge.bin"), Buffer.alloc(20 * 1024 * 1024 + 1));
  const client = new LifeClient({ api: "https://example.com", token: "synthetic", profile: "personal", fetch: async () => assert.fail("must not upload") });
  for (const path of [join(root, "outside.txt"), join(cache, "link.txt"), join(cache, "empty.txt"), join(cache, "huge.bin"), cache]) {
    await assert.rejects(uploadLocalAttachment(client, [cache], { path }), ToolFailure);
  }
  const file = join(cache, "note.txt"), bytes = Buffer.from("original"); await writeFile(file, bytes);
  for (const body of [{ ...receipt(bytes, "text/plain"), sha256: "0".repeat(64) }, { ok: true }]) {
    const fake = new LifeClient({ api: "https://example.com", token: "synthetic", profile: "personal", fetch: async () => Response.json(body) });
    await assert.rejects(uploadLocalAttachment(fake, [cache], { path: file, media_type: "text/plain" }), (error: unknown) => error instanceof ToolFailure && error.detail.code === "outcome_unknown");
  }
});

test("image uploads detect the actual raster format", async t => {
  const root = await mkdtemp(join(tmpdir(), "life-attachment-")); t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64"), path = join(root, "photo.jpg");
  await writeFile(path, bytes);
  const client = new LifeClient({ api: "https://example.com", token: "synthetic", profile: "personal", fetch: async (_, init) => {
    assert.equal(new Headers(init?.headers).get("content-type"), "image/png"); return Response.json(receipt(bytes, "image/png"));
  } });
  assert.equal((await uploadLocalAttachment(client, [root], { path, media_type: "image/jpeg" })).media_type, "image/png");
});

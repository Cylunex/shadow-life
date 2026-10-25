import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { stableId } from "@shadow/contracts";
import { ToolFailure, type LifeClient } from "./client.js";

const maxBytes = 20 * 1024 * 1024;
const inputSchema = z.object({ path: z.string().min(1).max(4096) }).strict();
const uploadResult = z.object({ protocol: z.literal("shadow.asset"), asset_id: stableId, asset_version_id: stableId, sha256: z.string().regex(/^[a-f0-9]{64}$/u), bytes: z.number().int().positive().max(maxBytes), media_type: z.string() });
export const uploadTool = {
  name: "assets.upload_local_image", description: "上传消息附带的原始图片（最多 20 MiB），仅限配置的媒体缓存目录。随后把 asset_version_id 关联到 source/sources；上传成功本身不代表已关联业务记录。",
  inputSchema: z.toJSONSchema(inputSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
};
function fail(message: string): never { throw new ToolFailure({ protocol: "shadow.error", code: "validation", message }); }
function inside(path: string, root: string) { const suffix = relative(root, path); return suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(suffix)); }
function mediaType(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 16 && bytes.subarray(4, 8).toString("ascii") === "ftyp" && /avif|avis/u.test(bytes.subarray(8, 32).toString("ascii"))) return "image/avif";
  return fail("Only JPEG, PNG, GIF, WebP and AVIF images are supported.");
}
export async function uploadLocalImage(client: LifeClient, roots: readonly string[], args: unknown) {
  const { path } = inputSchema.parse(args);
  if (!isAbsolute(path) || !roots.some(root => inside(resolve(path), root))) fail("Image path must be inside an approved media-cache directory.");
  const canonicalRoots = (await Promise.all(roots.map(root => realpath(root).catch(() => null)))).filter((root): root is string => root !== null);
  let canonical: string;
  try { canonical = await realpath(path); } catch { return fail("The supplied image is not available in the media cache."); }
  if (!canonicalRoots.some(root => inside(canonical, root))) fail("Image resolves outside approved media-cache directories.");
  const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes: Buffer;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > maxBytes) fail("Image must be a regular file between 1 byte and 20 MiB.");
    const buffer = Buffer.alloc(info.size + 1); let used = 0;
    while (used < buffer.length) { const read = await file.read(buffer, used, buffer.length - used, null); if (read.bytesRead === 0) break; used += read.bytesRead; }
    if (used !== info.size) fail("Image changed while being read; retry when the upload has finished.");
    bytes = buffer.subarray(0, used);
  } finally { await file.close(); }
  const type = mediaType(bytes);
  const uploaded = await client.request("/api/assets", { method: "POST", headers: { "content-type": type }, body: new Uint8Array(bytes) }, true);
  const result = uploadResult.safeParse(uploaded);
  if (!result.success) throw new ToolFailure({ protocol: "shadow.error", code: "outcome_unknown", message: "Image upload returned an invalid asset receipt; do not claim attachment." });
  if (result.data.sha256 !== createHash("sha256").update(bytes).digest("hex") || result.data.bytes !== bytes.length || result.data.media_type !== type) throw new ToolFailure({ protocol: "shadow.error", code: "outcome_unknown", message: "Uploaded asset receipt does not match the original image; do not claim attachment." });
  return result.data;
}

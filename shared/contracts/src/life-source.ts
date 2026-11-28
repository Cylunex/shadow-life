/** OIDC issuer and mapped Life subject identify a data space across clients. */
export async function lifeSourceScope(issuer: unknown, environment: unknown, subject: unknown): Promise<string | undefined> {
  if (typeof issuer !== "string" || !issuer || issuer !== issuer.trim() ||
      typeof environment !== "string" || !environment.trim() || environment !== environment.trim() ||
      typeof subject !== "string" || !/^[a-z][a-z0-9_]{7,127}$/u.test(subject)) return;
  let url: URL;
  try { url = new URL(issuer); } catch { return; }
  if (!["https:", "http:"].includes(url.protocol) || !url.host || url.username || url.password || url.hash || url.search) return;
  const bytes = new TextEncoder().encode(JSON.stringify(["shadow-life-source-v1", issuer, environment, subject]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

import { readFileSync } from "node:fs";
import {
  projectDirectoryResultSchema,
  type ProjectDirectoryResult
} from "@shadow/contracts";

export type KnownProjectLinks = {
  foliantUrl?: string | undefined;
  gardenUrl?: string | undefined;
};

function knownProjects({ foliantUrl, gardenUrl }: KnownProjectLinks): ProjectDirectoryResult {
  const item = (
    id: "shadow-foliant" | "shadow-garden",
    url: string | undefined
  ) => ({
    id,
    title: id === "shadow-foliant" ? "股票研究" : "博客创作",
    subtitle:
      id === "shadow-foliant"
        ? "Shadow Foliant · 行情、组合与研究"
        : "Shadow Garden · 草稿、编辑与发布",
    icon: id === "shadow-foliant" ? ("chart-line" as const) : ("notebook-pen" as const),
    state: url ? ("configured" as const) : ("not_configured" as const),
    ...(url ? { target: { kind: "browser" as const, url } } : {}),
    auth_hint: "shadow_identity" as const,
    order: id === "shadow-foliant" ? 10 : 20
  });

  return projectDirectoryResultSchema.parse({
    schema_version: 1,
    catalog_revision: foliantUrl || gardenUrl ? "known-projects-env-1" : "unconfigured",
    items: [item("shadow-foliant", foliantUrl), item("shadow-garden", gardenUrl)]
  });
}

export function loadProjectLinks(
  value: string | undefined,
  file: string | undefined,
  known: KnownProjectLinks = {}
): ProjectDirectoryResult {
  const hasKnownLinks = Boolean(known.foliantUrl || known.gardenUrl);
  if ([Boolean(value), Boolean(file), hasKnownLinks].filter(Boolean).length > 1) {
    throw new Error(
      "Configure only one project directory source: SHADOW_PROJECT_LINKS, SHADOW_PROJECT_LINKS_FILE, or the known project URLs"
    );
  }

  const raw = file ? readFileSync(file, "utf8") : value;
  if (raw === undefined) return knownProjects(known);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Shadow project directory must be valid JSON");
  }
  return projectDirectoryResultSchema.parse(parsed);
}

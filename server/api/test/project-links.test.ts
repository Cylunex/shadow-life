import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadProjectLinks } from "../src/project-links.js";

describe("project directory configuration", () => {
  it("keeps both known projects visible when endpoints are not configured", () => {
    const catalog = loadProjectLinks(undefined, undefined);

    assert.equal(catalog.catalog_revision, "unconfigured");
    assert.deepEqual(
      catalog.items.map((item) => [item.id, item.state]),
      [
        ["shadow-foliant", "not_configured"],
        ["shadow-garden", "not_configured"]
      ]
    );
    assert.ok(catalog.items.every((item) => item.auth_hint === "shadow_identity"));
  });

  it("connects Foliant and Garden from their concise deployment variables", () => {
    const catalog = loadProjectLinks(undefined, undefined, {
      foliantUrl: "https://stock.example.com/",
      gardenUrl: "https://garden.example.com/admin/"
    });

    assert.equal(catalog.catalog_revision, "known-projects-env-1");
    assert.deepEqual(
      catalog.items.map((item) => item.target),
      [
        { kind: "browser", url: "https://stock.example.com/" },
        { kind: "browser", url: "https://garden.example.com/admin/" }
      ]
    );
  });

  it("rejects unsafe endpoints and ambiguous configuration", () => {
    assert.throws(
      () => loadProjectLinks(undefined, undefined, { foliantUrl: "http://stock.example.com/" }),
      /project links must use HTTPS/
    );
    assert.throws(
      () =>
        loadProjectLinks(
          '{"schema_version":1,"catalog_revision":"test","items":[]}',
          undefined,
          { gardenUrl: "https://garden.example.com/admin/" }
        ),
      /only one project directory source/
    );
  });
});

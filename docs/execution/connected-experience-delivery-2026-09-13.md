# Connected native experience delivery

Reference review: `doc/shadow-life-connected-experience-plan-20597a5.md` at the local Shadow workspace root.

## Delivered

- A searchable native feature directory exposes stable entry points for Health Connect, Samsung Health, Xiaomi
  scales, meals, money, travel, owned items, plans and Library capture.
- Each domain workspace keeps its high-frequency capture actions in context. Health keeps device synchronization in
  the same workspace as its records.
- Project, owned-item and life-review routes load by exact owner-scoped ID. They no longer depend on an object being
  present in the first already-loaded Planning page.
- Record detail relations are typed links. Meal payments open their money records; money and purchase records open
  linked meals. A CNY expense can start a prefilled refund, and a purchase line can start a prefilled owned item.
- The meal form uses structured food rows, quantities and units, with multiline paste retained for advanced entry.
- Queue completion and assistant execution receipts drive capability-scoped query invalidation after the server has
  committed the command. The provisional queued receipt is replaced with the authoritative committed receipt.

## Intentionally not overstated

The reference plan combines confirmed defects with proposed multi-phase product work. This delivery fixes its P0
navigation, cold-load and refresh defects and the reusable P1 interaction foundation. The following proposals still
need dedicated domain contracts and scenario acceptance before they can be called complete:

- dedicated recipe, health-plan and recurring-plan detail/edit routes;
- complete shopping-list, map, budget and project-action management screens;
- share-to-existing-object and single-asset reverse-reference flows;
- attachment preview and object-scoped assistant conversation/result navigation;
- one-save dining orchestration that can attach existing payments and sources without duplicate facts.

Until those increments are delivered, corresponding aggregate cards remain honest summaries; navigation never
pretends that opening a general workspace is the same as opening a specific object.

## Verification boundary

Automated verification covers generated contracts, TypeScript project boundaries and tests, Android production policy
checks, and Kotlin compilation with and without the reviewed Samsung SDK AAR. The complete isolated PostgreSQL run
passes all 176 tests after applying all 34 migrations. Physical-device Samsung authorization, background scheduling
and Xiaomi radio behavior remain device acceptance work and are not inferred from compilation.

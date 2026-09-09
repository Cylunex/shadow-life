# ADR 0001: transaction and identity boundaries

Status: accepted for R1.

`life.record_meal` is one workflow and the sole owner of its transaction. It may create a Meal, IntakeItems,
an explicitly supplied MoneyEntry, a Source link, an Operation and an Outbox row. Module repositories do not
commit independently. Queue publication happens after the transaction through the Outbox dispatcher.

The API constructs `RequestContext`. Input schemas contain no owner, approval or scope field. Development
Bearer identities exist only behind `SHADOW_DEV_AUTH=true`, which is rejected with `NODE_ENV=production`.
Production identity integration remains disabled until a verified issuer/sub adapter is implemented.

Normal meal and expense recording executes directly when required facts and effects are present. The product
does not create a review object. Missing money permission rejects the combined command; a caller may submit a
new meal-only command with a new stable command ID.

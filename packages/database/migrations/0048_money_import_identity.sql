BEGIN;

ALTER TABLE money_import_batches
  ADD COLUMN platform text NOT NULL DEFAULT 'generic' CHECK (platform IN ('generic','meituan','jd','taobao','alipay','wechat')),
  ADD COLUMN source_account text NOT NULL DEFAULT 'default' CHECK (length(btrim(source_account)) BETWEEN 1 AND 200),
  ADD COLUMN parser_version text NOT NULL DEFAULT '1';

ALTER TABLE money_import_candidates
  ADD COLUMN platform text NOT NULL DEFAULT 'generic' CHECK (platform IN ('generic','meituan','jd','taobao','alipay','wechat')),
  ADD COLUMN source_account text NOT NULL DEFAULT 'default' CHECK (length(btrim(source_account)) BETWEEN 1 AND 200),
  ADD COLUMN identity_kind text CHECK (identity_kind IN ('expense','income','refund')),
  ADD COLUMN source_proposed jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN duplicate_of_candidate_id text REFERENCES money_import_candidates(id);

-- Preserve pre-upgrade candidates; no historical entry is rewritten or removed.
UPDATE money_import_candidates SET source_proposed=proposed,
  identity_kind=CASE WHEN proposed->>'entry_type' IN ('expense','income','refund') THEN proposed->>'entry_type' END;

-- The former generic parser already accepted platform exports. Recover a namespace
-- only from a complete original header signature, never from a filename or merchant.
WITH normalized AS (
  SELECT candidate.id,coalesce((SELECT jsonb_object_agg(regexp_replace(lower(key),'[[:space:]_-]+','','g'),value)
    FROM jsonb_each(candidate.raw)), '{}'::jsonb) raw
  FROM money_import_candidates candidate
), identified AS (
  SELECT id,raw,CASE
    WHEN raw ?& ARRAY['订单号','订单提交时间','订单状态','商品名称','实付金额'] THEN 'taobao'
    WHEN raw ?& ARRAY['交易创建时间','交易类型','订单标题','实付金额'] THEN 'meituan'
    WHEN raw ?& ARRAY['商户名称','交易说明','交易订单号','交易状态'] THEN 'jd'
    WHEN raw ?& ARRAY['交易单号','当前状态','商品','收/支'] THEN 'wechat'
    WHEN raw ?& ARRAY['交易订单号','交易对方','商品说明','交易状态'] THEN 'alipay'
    ELSE 'generic' END platform
  FROM normalized
)
UPDATE money_import_candidates candidate SET platform=identified.platform,
  external_id=CASE WHEN identified.platform='generic' THEN candidate.external_id
    WHEN identified.platform='taobao' THEN coalesce(nullif(btrim(identified.raw->>'订单号'),''),candidate.external_id)
    ELSE coalesce(
      CASE WHEN candidate.identity_kind='refund' THEN coalesce(nullif(btrim(identified.raw->>'退款单号'),''),nullif(btrim(identified.raw->>'退款交易号'),'')) END,
      nullif(btrim(identified.raw->>'交易单号'),''),nullif(btrim(identified.raw->>'交易订单号'),''),nullif(btrim(identified.raw->>'交易号'),''),candidate.external_id)
    END
FROM identified WHERE identified.id=candidate.id;

UPDATE money_import_batches batch SET platform=identities.platform
FROM (SELECT batch_id,min(platform) platform FROM money_import_candidates GROUP BY batch_id HAVING count(DISTINCT platform)=1) identities
WHERE identities.batch_id=batch.id;

-- Before parser v2, proposed fields could be corrected without retaining source facts.
-- Preserve the old external-ID protection: an unknown historical event kind matches
-- both movements and refunds instead of treating a corrected type as a new identity.
UPDATE money_import_candidates SET identity_kind=NULL;

CREATE INDEX money_import_candidates_identity_idx
  ON money_import_candidates(subject_id,platform,source_account,external_id,identity_kind)
  WHERE external_id IS NOT NULL AND status <> 'ignored';
CREATE INDEX money_import_batches_subject_created_idx
  ON money_import_batches(subject_id,created_at DESC,id DESC);

COMMIT;

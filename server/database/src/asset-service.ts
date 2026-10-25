import { createHash } from "node:crypto";
import type { Pool } from "pg";

export type StoredAsset={protocol:"shadow.asset";asset_id:string;asset_version_id:string;sha256:string;bytes:number;media_type:string};

export class AssetService{
  constructor(private readonly pool:Pool){}
  async store(subjectId:string,mediaType:string,bytes:Buffer,representation?:{sourceVersionId:string;processor:string;kind:string}):Promise<StoredAsset>{
    const digest=createHash("sha256").update(bytes).digest("hex"),legacyKey=`${subjectId}:${digest}`,client=await this.pool.connect();
    try{
      await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtextextended($1,6))",[legacyKey]);
      // Preserve existing original identities. A MIME variant or derived representation has its own
      // deterministic logical identity, while sha256 continues to describe exactly the same blob bytes.
      const legacyShort=createHash("sha256").update(legacyKey).digest("hex").slice(0,24);
      const existing=await client.query<{subject_id:string;media_type:string}>("select subject_id,media_type from assets where id=$1",[`asset_${legacyShort}`]);
      if(existing.rowCount&&existing.rows[0]!.subject_id!==subjectId)throw new Error("asset identity collision");
      const identity=representation?JSON.stringify([subjectId,digest,mediaType,"derived",representation.sourceVersionId,representation.processor,representation.kind]):existing.rowCount&&existing.rows[0]!.media_type!==mediaType?JSON.stringify([subjectId,digest,mediaType,"original"]):legacyKey;
      const short=createHash("sha256").update(identity).digest("hex").slice(0,24),assetId=`asset_${short}`,versionId=`assetv_${short}`;
      const collision=await client.query<{subject_id:string;media_type:string}>("select subject_id,media_type from assets where id=$1",[assetId]);
      if(collision.rowCount&&(collision.rows[0]!.subject_id!==subjectId||collision.rows[0]!.media_type!==mediaType))throw new Error("asset identity collision");
      await client.query("insert into assets(id,subject_id,media_type) values($1,$2,$3) on conflict(id) do nothing",[assetId,subjectId,mediaType]);await client.query("insert into asset_versions(id,asset_id,sha256,byte_size,storage_key) values($1,$2,$3,$4,$5) on conflict(asset_id,sha256) do nothing",[versionId,assetId,digest,bytes.length,`postgres://${versionId}`]);await client.query("insert into asset_blobs(asset_version_id,bytes) values($1,$2) on conflict(asset_version_id) do nothing",[versionId,bytes]);await client.query("commit");return{protocol:"shadow.asset",asset_id:assetId,asset_version_id:versionId,sha256:digest,bytes:bytes.length,media_type:mediaType};}catch(error){await client.query("rollback");throw error;}finally{client.release();}
  }
}

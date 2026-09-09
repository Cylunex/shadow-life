import { createHash } from "node:crypto";
import type { Pool } from "pg";

export type StoredAsset={protocol:"shadow.asset";asset_id:string;asset_version_id:string;sha256:string;bytes:number;media_type:string};

export class AssetService{
  constructor(private readonly pool:Pool){}
  async store(subjectId:string,mediaType:string,bytes:Buffer):Promise<StoredAsset>{
    const digest=createHash("sha256").update(bytes).digest("hex"),assetId=`asset_${createHash("sha256").update(`${subjectId}:${digest}`).digest("hex").slice(0,24)}`,versionId=`assetv_${createHash("sha256").update(`${subjectId}:${digest}`).digest("hex").slice(0,24)}`;const client=await this.pool.connect();
    try{await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtextextended($1,6))",[`${subjectId}:${digest}`]);const existing=await client.query<{subject_id:string;media_type:string}>("select subject_id,media_type from assets where id=$1",[assetId]);if(existing.rowCount&&(existing.rows[0]!.subject_id!==subjectId||existing.rows[0]!.media_type!==mediaType))throw new Error("asset identity collision");await client.query("insert into assets(id,subject_id,media_type) values($1,$2,$3) on conflict(id) do nothing",[assetId,subjectId,mediaType]);await client.query("insert into asset_versions(id,asset_id,sha256,byte_size,storage_key) values($1,$2,$3,$4,$5) on conflict(asset_id,sha256) do nothing",[versionId,assetId,digest,bytes.length,`postgres://${versionId}`]);await client.query("insert into asset_blobs(asset_version_id,bytes) values($1,$2) on conflict(asset_version_id) do nothing",[versionId,bytes]);await client.query("commit");return{protocol:"shadow.asset",asset_id:assetId,asset_version_id:versionId,sha256:digest,bytes:bytes.length,media_type:mediaType};}catch(error){await client.query("rollback");throw error;}finally{client.release();}
  }
}

import { createPublicKey, verify } from "node:crypto";

export type LegacyProofVerification={state:"verified"|"invalid";error:string|null};

export function verifyEd25519Sha256AsciiProof(value:{publicKeyPem:string;signatureBase64:string;contentSha256:string}):LegacyProofVerification{
  if(!/^[0-9a-f]{64}$/u.test(value.contentSha256))return{state:"invalid",error:"signed content hash is not canonical SHA-256"};
  try{
    const key=createPublicKey(value.publicKeyPem);
    if(key.asymmetricKeyType!=="ed25519")return{state:"invalid",error:"public key is not Ed25519"};
    const signature=Buffer.from(value.signatureBase64,"base64");
    if(signature.length!==64)return{state:"invalid",error:"Ed25519 signature must contain 64 bytes"};
    return verify(null,Buffer.from(value.contentSha256,"ascii"),key,signature)?{state:"verified",error:null}:{state:"invalid",error:"signature verification failed"};
  }catch{return{state:"invalid",error:"public key or signature could not be decoded"};}
}

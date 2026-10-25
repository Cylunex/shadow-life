import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { verifyEd25519Sha256AsciiProof } from "../src/library-proof.js";

test("legacy Ed25519 proof verifies the explicit ASCII digest protocol",()=>{
  const {privateKey,publicKey}=generateKeyPairSync("ed25519"),digest="a".repeat(64);
  const signature=sign(null,Buffer.from(digest,"ascii"),privateKey).toString("base64");
  assert.deepEqual(verifyEd25519Sha256AsciiProof({publicKeyPem:publicKey.export({format:"pem",type:"spki"}).toString(),signatureBase64:signature,contentSha256:digest}),{state:"verified",error:null});
  assert.equal(verifyEd25519Sha256AsciiProof({publicKeyPem:publicKey.export({format:"pem",type:"spki"}).toString(),signatureBase64:signature,contentSha256:"b".repeat(64)}).state,"invalid");
});

test("legacy proof rejects non-Ed25519 keys and malformed signatures",()=>{
  const rsa=generateKeyPairSync("rsa",{modulusLength:2048}).publicKey.export({format:"pem",type:"spki"}).toString();
  assert.match(verifyEd25519Sha256AsciiProof({publicKeyPem:rsa,signatureBase64:Buffer.alloc(64).toString("base64"),contentSha256:"c".repeat(64)}).error!,/not Ed25519/u);
  const ed=generateKeyPairSync("ed25519").publicKey.export({format:"pem",type:"spki"}).toString();
  assert.match(verifyEd25519Sha256AsciiProof({publicKeyPem:ed,signatureBase64:Buffer.alloc(12).toString("base64"),contentSha256:"c".repeat(64)}).error!,/64 bytes/u);
});

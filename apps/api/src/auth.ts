import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { RequestContext } from "@shadow/kernel";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createHash, timingSafeEqual } from "node:crypto";

declare module "hono" {
  interface ContextVariableMap { requestContext: RequestContext; }
}

const developmentEffects = new Set(["life.meal.write", "life.meal.read", "life.purchase.write", "life.item.write", "life.item.read", "life.review.write", "life.review.read", "life.project.write", "life.project.read", "life.meal_plan.write", "life.meal_plan.read", "money.entry.write", "money.refund.write", "money.budget.write", "money.plan.write", "money.summary.read", "money.entry.read", "health.measurement.write", "health.raw.ingest", "health.measurement.read", "travel.trip.write", "travel.reservation.write", "travel.visit.write", "travel.trip.read", "library.source.link", "library.item.write", "library.processor.write", "library.item.read", "library.asset.read", "notifications.read", "notifications.write", "operations.read", "agent.run"]);

const knownEffects = developmentEffects;
type AuthOptions={development:boolean;issuer?:string;audience?:string;jwksUrl?:string;webOrigin?:string;proxyAuth?:{secret:string;subjectId:string}};
const jwksCache=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
function claimString(payload:JWTPayload,key:string):string|undefined{const value=payload[key];return typeof value==="string"?value:undefined;}
function effectsFrom(payload:JWTPayload):ReadonlySet<string>{
  const direct=Array.isArray(payload.effects)?payload.effects:typeof payload.scope==="string"?payload.scope.split(" "):[];
  return new Set(direct.filter((effect):effect is string=>typeof effect==="string"&&knownEffects.has(effect)));
}
function writeEpochs(value:string|undefined):Readonly<Partial<Record<"health"|"ledger",number>>>|undefined{if(!value)return undefined;const result:Partial<Record<"health"|"ledger",number>>={};for(const part of value.split(",")){const [domain,raw]=part.split("=");const epoch=Number(raw);if((domain!=="health"&&domain!=="ledger")||!Number.isSafeInteger(epoch)||epoch<1)throw new Error("invalid write epoch");result[domain]=epoch;}return result;}
function sameSecret(actual:string|undefined,expected:string):boolean{if(!actual)return false;return timingSafeEqual(createHash("sha256").update(actual).digest(),createHash("sha256").update(expected).digest());}

export function authMiddleware(options: AuthOptions): MiddlewareHandler {
  if (options.development && process.env.NODE_ENV === "production") throw new Error("SHADOW_DEV_AUTH cannot run in production");
  if(options.proxyAuth&&(!/^[a-z][a-z0-9_]{7,127}$/u.test(options.proxyAuth.subjectId)||options.proxyAuth.secret.length<32))throw new Error("Trusted proxy auth requires a valid subject and a secret of at least 32 characters");
  return async (context, next) => {
    if(options.proxyAuth&&sameSecret(context.req.header("x-shadow-proxy-secret"),options.proxyAuth.secret)){
      let epochs;try{epochs=writeEpochs(context.req.header("x-shadow-write-epochs"));}catch{return context.json({protocol:"shadow.error",code:"validation",message:"x-shadow-write-epochs is invalid."},422);}
      const subjectId=options.proxyAuth.subjectId;context.set("requestContext",{actorId:subjectId,subjectId,clientId:"client_trusted_proxy",issuer:"shadow:trusted-proxy",effects:developmentEffects,traceId:context.req.header("x-request-id")??crypto.randomUUID(),...(epochs?{writeEpochs:epochs}:{})});await next();return;
    }
    const headerAuthorization=context.req.header("authorization"),cookieToken=getCookie(context,"shadow_access_token"),authorization=headerAuthorization??(cookieToken?`Bearer ${cookieToken}`:"");
    if(options.development&&authorization.startsWith("Bearer dev:")){
      const subjectId=authorization.slice("Bearer dev:".length);if(!/^[a-z][a-z0-9_]{7,127}$/u.test(subjectId))return context.json({protocol:"shadow.error",code:"permission_denied",message:"The development subject is invalid."},401);
      let epochs;try{epochs=writeEpochs(context.req.header("x-shadow-write-epochs"));}catch{return context.json({protocol:"shadow.error",code:"validation",message:"x-shadow-write-epochs is invalid."},422);}context.set("requestContext",{actorId:subjectId,subjectId,clientId:"client_development",issuer:"shadow:development",effects:developmentEffects,traceId:context.req.header("x-request-id")??crypto.randomUUID(),...(epochs?{writeEpochs:epochs}:{})});await next();return;
    }
    if(!authorization.startsWith("Bearer ")||!options.issuer||!options.audience||!options.jwksUrl)return context.json({protocol:"shadow.error",code:"permission_denied",message:"A verified product session is required."},401);
    if(!headerAuthorization&&!["GET","HEAD","OPTIONS"].includes(context.req.method)&&context.req.header("origin")!==options.webOrigin)return context.json({protocol:"shadow.error",code:"permission_denied",message:"The request origin is invalid."},403);
    try{
      let jwks=jwksCache.get(options.jwksUrl);if(!jwks){jwks=createRemoteJWKSet(new URL(options.jwksUrl));jwksCache.set(options.jwksUrl,jwks);}
      const {payload}=await jwtVerify(authorization.slice(7),jwks,{issuer:options.issuer,audience:options.audience,algorithms:["RS256","ES256","EdDSA"]});
      const subjectId=claimString(payload,"shadow_subject")??payload.sub,actorId=payload.sub,clientId=claimString(payload,"client_id")??claimString(payload,"azp");
      if(!subjectId||!actorId||!clientId||!/^[a-z][a-z0-9_]{7,127}$/u.test(subjectId))throw new Error("required identity claims are missing");
      const effects=effectsFrom(payload);if(effects.size===0)throw new Error("token has no supported effects");
      const epochs=writeEpochs(context.req.header("x-shadow-write-epochs"));context.set("requestContext",{actorId,subjectId,clientId,issuer:options.issuer,effects,traceId:context.req.header("x-request-id")??crypto.randomUUID(),...(epochs?{writeEpochs:epochs}:{})});await next();
    }catch{return context.json({protocol:"shadow.error",code:"permission_denied",message:"The product session is invalid or expired."},401);}
  };
}

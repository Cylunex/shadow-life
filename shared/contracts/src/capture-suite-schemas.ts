import { z } from "zod";
const id=z.string().regex(/^[a-z][a-z0-9_]{7,127}$/u);
const time=z.iso.datetime({offset:true});
const zone=z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat("en",{timeZone:v});return true;}catch{return false;}});
export const captureDateSchema=z.object({date:z.iso.date(),time_zone:zone,recordings_before_id:id.optional()}).strict();
export const recordingSegmentSchema=z.object({segment_id:id,session_id:id,segment_index:z.number().int().min(0).max(100000),title:z.string().trim().min(1).max(200),started_at:time,ended_at:time,time_zone:zone,asset_version_id:id}).strict().refine(v=>Date.parse(v.ended_at)>Date.parse(v.started_at)&&Date.parse(v.ended_at)-Date.parse(v.started_at)<=300000,{message:"Recording segments must be positive and at most five minutes"});
export const transcriptSpanSchema=z.object({start_ms:z.number().int().nonnegative(),end_ms:z.number().int().positive(),text:z.string().trim().min(1).max(4000),speaker:z.string().max(80).nullable().default(null)}).strict().refine(v=>v.end_ms>v.start_ms);
export const recordingJobSchema=z.object({segment_id:id,expected_attempt:z.number().int().nonnegative()}).strict();
export const completeRecordingSchema=z.object({segment_id:id,attempt:z.number().int().positive(),processor_version:z.string().min(1).max(100),spans:z.array(transcriptSpanSchema).max(500)}).strict();
export const failRecordingSchema=z.object({segment_id:id,attempt:z.number().int().positive(),message:z.string().max(500)}).strict();
export const recordingActionSchema=z.object({segment_id:id}).strict();
export const reviseTranscriptSchema=z.object({segment_id:id,expected_revision:z.number().int().positive(),spans:z.array(transcriptSpanSchema).max(500),reason:z.string().trim().min(1).max(500)}).strict();
export const orderCaptureRuleSchema=z.object({app_package:z.string().trim().min(1).max(300),platform:z.enum(["generic","taobao","jd","meituan","alipay","wechat"]),source_account:z.string().trim().min(1).max(200),enabled:z.boolean(),auto_accounting:z.boolean().default(false)}).strict();
export const activityReviewInputSchema=z.object({date:z.iso.date(),time_zone:zone,period:z.enum(["day","week","month"])}).strict();
export const captureWorkspaceResultSchema=z.object({
 recordings:z.array(z.object({id,session_id:id,title:z.string(),started_at:time,ended_at:time,asset_version_id:id,state:z.enum(["queued","running","completed","failed"]),revision:z.number().int().positive(),attempt:z.number().int().nonnegative(),spans:z.array(transcriptSpanSchema),error:z.string().nullable(),processor_version:z.string().nullable(),audio_available:z.boolean(),protected:z.boolean()}).strict()).max(100),
 orders:z.array(z.object({id,platform:z.string(),source_account:z.string(),external_id:z.string(),status:z.string(),source_count:z.number().int().nonnegative(),fields:z.string(),record_id:z.string().nullable(),conflict:z.boolean()}).strict()).max(100),
 rules:z.array(orderCaptureRuleSchema).max(100),
 reviews:z.array(z.object({id,period:z.enum(["day","week","month"]),from_on:z.iso.date(),to_on_exclusive:z.iso.date(),time_zone:zone,revision:z.number().int().positive(),stale:z.boolean(),body:z.string(),source_refs:z.array(z.object({id,title:z.string(),started_at:time}).strict()).max(500),source_count:z.number().int().nonnegative(),generated_at:time}).strict()).max(12),
 recordings_next_before_id:id.nullable(),truncated:z.boolean(),transcription_available:z.boolean()
}).strict();

const remoteTranscriptConfigSchema=z.object({url:z.url(),model:z.string().min(1).max(100),token_file:z.string().optional(),language:z.string().max(20).optional(),timeout_ms:z.number().int().min(1000).max(180000).default(120000)}).strict();
const localTranscriptConfigSchema=z.object({kind:z.literal("local"),python:z.string().min(1),model_path:z.string().min(1),model_id:z.string().max(60).default("local-whisper"),expected_model_bytes:z.number().int().positive().optional(),language:z.string().max(20).default("zh"),cpu_threads:z.number().int().min(1).max(8).default(2),timeout_ms:z.number().int().min(1000).max(180000).default(180000)}).strict();
export const transcriptConfigSchema=z.union([localTranscriptConfigSchema,remoteTranscriptConfigSchema]);
export const transcriptResponseSchema=z.object({text:z.string().optional(),segments:z.array(z.object({start:z.number().nonnegative(),end:z.number().positive(),text:z.string(),speaker:z.string().optional()}).passthrough()).max(500)}).passthrough();
export type TranscriptConfig=z.infer<typeof transcriptConfigSchema>;
export type TranscriptSpans=z.infer<typeof completeRecordingSchema>["spans"];

export const captureScreenshotSchema=z.object({asset_version_id:id,title:z.string().trim().min(1).max(200),captured_at:time,time_zone:zone,app_package:z.string().trim().min(1).max(300).optional(),text:z.string().trim().min(1).max(12000).optional()}).strict().refine(v=>!v.text||Boolean(v.app_package),{message:"Visible screenshot text requires its source application"});

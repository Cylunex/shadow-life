import { sha256Fingerprinter } from "./runtime.js";

export interface TravelTrackPoint {latitude:number;longitude:number;elevation_m?:number;recorded_at?:string;}

function xmlText(value:string):string{return value.replace(/&/gu,"&amp;").replace(/</gu,"&lt;").replace(/>/gu,"&gt;").replace(/"/gu,"&quot;").replace(/'/gu,"&apos;");}
function decodeXml(value:string):string{return value.replace(/&(amp|lt|gt|quot|apos);/gu,(_,entity:string)=>({amp:"&",lt:"<",gt:">",quot:'"',apos:"'"})[entity]!);}

export function parseGpx(gpx:string):{name:string|null;points:TravelTrackPoint[]} {
  if(Buffer.byteLength(gpx,"utf8")>900_000)throw new Error("GPX exceeds 900000 bytes");
  if(/<!DOCTYPE|<!ENTITY/iu.test(gpx))throw new Error("GPX declarations and external entities are not allowed");
  if(!/<gpx(?:\s|>)/iu.test(gpx))throw new Error("GPX root element is missing");
  const points:TravelTrackPoint[]=[];
  const pointPattern=/<(?:\w+:)?(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?(?:trkpt|rtept)>/giu;
  for(const match of gpx.matchAll(pointPattern)){
    if(points.length>=10_000)throw new Error("GPX has more than 10000 points");
    const attributes=match[1]!,body=match[2]!;
    const lat=attributes.match(/\blat\s*=\s*["']([^"']+)["']/iu),lon=attributes.match(/\blon\s*=\s*["']([^"']+)["']/iu);
    const latitude=Number(lat?.[1]),longitude=Number(lon?.[1]);
    if(!Number.isFinite(latitude)||latitude < -90||latitude > 90||!Number.isFinite(longitude)||longitude < -180||longitude > 180)throw new Error("GPX point has invalid coordinates");
    const elevationText=body.match(/<(?:\w+:)?ele>([^<]+)<\/(?:\w+:)?ele>/iu)?.[1],timeText=body.match(/<(?:\w+:)?time>([^<]+)<\/(?:\w+:)?time>/iu)?.[1];
    const point:TravelTrackPoint={latitude,longitude};
    if(elevationText!==undefined){const elevation=Number(elevationText.trim());if(!Number.isFinite(elevation))throw new Error("GPX point has invalid elevation");point.elevation_m=elevation;}
    if(timeText!==undefined){const instant=timeText.trim();if(!Number.isFinite(Date.parse(instant)))throw new Error("GPX point has invalid time");point.recorded_at=new Date(instant).toISOString();}
    points.push(point);
  }
  if(points.length===0)throw new Error("GPX contains no track or route points");
  const nameMatch=gpx.match(/<(?:\w+:)?(?:trk|rte)\b[^>]*>[\s\S]*?<(?:\w+:)?name>([^<]*)<\/(?:\w+:)?name>/iu);
  return{name:nameMatch?decodeXml(nameMatch[1]!.trim()):null,points};
}

export function serializeGpx(name:string,tracks:readonly {name:string;points:readonly TravelTrackPoint[]}[]):string{
  const segments=tracks.map(track=>`    <trk><name>${xmlText(track.name)}</name><trkseg>\n${track.points.map(point=>`      <trkpt lat="${point.latitude}" lon="${point.longitude}">${point.elevation_m===undefined?"":`<ele>${point.elevation_m}</ele>`}${point.recorded_at===undefined?"":`<time>${xmlText(point.recorded_at)}</time>`}</trkpt>`).join("\n")}\n    </trkseg></trk>`).join("\n");
  return`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Shadow Life" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${xmlText(name)}</name></metadata>\n${segments}\n</gpx>\n`;
}

function addDay(date:string):string{const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+1);return value.toISOString().slice(0,10);}
function icsDate(date:string):string{return date.replaceAll("-","");}
function icsText(value:string):string{return value.replace(/\\/gu,"\\\\").replace(/\r?\n/gu,"\\n").replace(/,/gu,"\\,").replace(/;/gu,"\\;");}
export function serializeTripIcs(trip:{id:string;title:string;starts_on:string;ends_on:string;note?:string|null}):string{
  const description=trip.note?`DESCRIPTION:${icsText(trip.note)}\r\n`:"";
  return`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Shadow Life//Travel//EN\r\nCALSCALE:GREGORIAN\r\nBEGIN:VEVENT\r\nUID:${icsText(trip.id)}@shadow-life\r\nDTSTART;VALUE=DATE:${icsDate(trip.starts_on)}\r\nDTEND;VALUE=DATE:${icsDate(addDay(trip.ends_on))}\r\nSUMMARY:${icsText(trip.title)}\r\n${description}END:VEVENT\r\nEND:VCALENDAR\r\n`;
}

function stableValue(value:unknown):unknown{if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==="object"&&!(value instanceof Date))return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stableValue(item)]));return value;}
export function serializeTravelBundle(value:unknown):string{return `${JSON.stringify(stableValue(value),null,2)}\n`;}
export function portableDocument(format:"bundle"|"gpx"|"ics",filename:string,mimeType:string,content:string){return{format,mime_type:mimeType,filename,sha256:sha256Fingerprinter.fingerprint(content),content};}

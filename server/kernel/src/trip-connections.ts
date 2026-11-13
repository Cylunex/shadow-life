export function connectionMargin(departure:string, target:string, travelMinutes:number, bufferMinutes:number) {
  return Math.floor((Date.parse(target)-Date.parse(departure))/60_000)-travelMinutes-bufferMinutes;
}

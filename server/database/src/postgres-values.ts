export function rowsBy<Key,Row>(rows:readonly Row[],keyFor:(row:Row)=>Key):ReadonlyMap<Key,readonly Row[]>{
  const grouped=new Map<Key,Row[]>();
  for(const row of rows){const key=keyFor(row),values=grouped.get(key)??[];values.push(row);grouped.set(key,values);}
  return grouped;
}

export function trimNumeric(value: string | null): string | null {
  if (value === null) return null;
  return value.includes(".") ? value.replace(/0+$/u, "").replace(/\.$/u, "") : value;
}

export function moneyNumeric(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

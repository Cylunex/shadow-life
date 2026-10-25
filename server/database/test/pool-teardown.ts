import type { Pool, PoolClient } from "pg";

// Register before the pool is first used. pg-pool can resolve end() after it
// removes clients from its list but before their sockets finish closing.
export function trackPoolShutdown(pool:Pool):()=>Promise<void>{
  const connections=new Set<PoolClient>();
  let drained:(()=>void)|undefined;
  const connect=(client:PoolClient)=>{connections.add(client);};
  const remove=(client:PoolClient)=>{connections.delete(client);if(connections.size===0)drained?.();};
  pool.on("connect",connect);pool.on("remove",remove);
  return async()=>{
    const closed=new Promise<void>(resolve=>{drained=resolve;});
    await pool.end();
    if(connections.size>0)await closed;
    pool.off("connect",connect);pool.off("remove",remove);
  };
}

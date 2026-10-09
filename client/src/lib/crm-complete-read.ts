import { apiRequest } from "./queryClient";

/** Consume the existing authorized offset reader, never infer completeness from
 * a requested limit. A changing population fails this relationship load rather
 * than returning a partial join as complete. Each retry starts a fresh load. */
export async function readCompleteCrmCollection<T extends {id:number}>(
  path:string, params:Record<string,string>, signal?:AbortSignal,
):Promise<{data:T[];total:number;asOf?:string;completeness:"complete_paged_read"}> {
  const rows:T[]=[];
  const ids=new Set<number>();
  let expectedTotal:number|undefined;
  let asOf:string|undefined;
  for(let offset=0;;) {
    const query=new URLSearchParams({...params,limit:"100",offset:String(offset)});
    const response=await apiRequest("GET",`${path}?${query}`,undefined,undefined,signal);
    const page=await response.json();
    if(!Array.isArray(page?.data) || !Number.isSafeInteger(page.total) || page.total<0)
      throw new Error("Relationship population/completeness unavailable");
    if(expectedTotal!==undefined && page.total!==expectedTotal) throw new Error("Relationship population changed during paging. Retry.");
    const total:number=page.total;
    expectedTotal=total;
    asOf=typeof page.asOf==="string" ? page.asOf : asOf;
    for(const row of page.data) {
      if(!Number.isSafeInteger(row?.id) || row.id<=0 || ids.has(row.id))
        throw new Error("Relationship page identity changed during paging. Retry.");
      ids.add(row.id);rows.push(row);
    }
    offset+=page.data.length;
    if(offset===total) return {data:rows,total,asOf,completeness:"complete_paged_read"};
    if(page.data.length===0 || offset>total) throw new Error("Relationship continuation incomplete");
  }
}

/** Bounded concurrency of exact object reads avoids first-page joins and does
 * not introduce another object/tenant authority in the browser. */
export async function readExactCrmContacts<T extends {id:number}>(ids:number[],signal?:AbortSignal):Promise<{data:T[]}> {
  const unique=[...new Set(ids)];
  const data:T[]=[];
  let next=0;
  await Promise.all(Array.from({length:Math.min(6,unique.length)},async()=>{
    while(next<unique.length) {
      const id=unique[next++];
      const result=await (await apiRequest("GET",`/api/contacts/${id}`,undefined,undefined,signal)).json();
      if(result?.id!==id) throw new Error("Exact contact relationship unavailable");
      data.push(result);
    }
  }));
  return {data};
}

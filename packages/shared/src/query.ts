export const SEARCH_INDEX_BYTES=1500;
// The same normalized field is used for saved titles and query bounds.
export function normalizeTitleSearch(value:string){return value.normalize('NFKC').toLowerCase();}
export function prefixUpperBound(prefix:string):string|undefined{
  const points=Array.from(prefix);
  for(let i=points.length-1;i>=0;i--){const cp=points[i].codePointAt(0)!;if(cp<0x10ffff){const next=cp===0xd7ff?0xe000:cp+1;return points.slice(0,i).join('')+String.fromCodePoint(next);}}
  return undefined;
}

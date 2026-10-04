import {collection,getDocsFromServer,query,where,orderBy,documentId,startAfter,limit,type Firestore,type QueryConstraint,type QueryDocumentSnapshot,type DocumentData,type Timestamp} from 'firebase/firestore';
import {normalizeTitleSearch,prefixUpperBound,SEARCH_INDEX_BYTES} from '@evertrace/shared';
export type PackFilters={prefix:string;categoryId:string;scope:'all'|'mine'};
export type ListedPack={id:string;title:string;titleSearch:string;ownerId:string;ownerName:string;categoryId:string;createdAt:Timestamp};
export type PackCursor={key:string;document:QueryDocumentSnapshot<DocumentData>};
export function packQueryKey(filters:PackFilters,uid:string){return JSON.stringify([normalizeTitleSearch(filters.prefix.trim()),filters.categoryId,filters.scope,uid]);}
export async function getPackPage(db:Firestore,filters:PackFilters,uid:string,cursor:PackCursor|null=null,pageSize=20){
  if(typeof filters.prefix!=='string'||filters.prefix.length>160||Array.from(filters.prefix).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)||/[\ud800-\udfff]/u.test(filters.prefix)||typeof filters.categoryId!=='string'||filters.categoryId&&!/^[A-Za-z0-9_-]{1,100}$/.test(filters.categoryId)||!['all','mine'].includes(filters.scope)||filters.scope==='mine'&&!uid||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new Error('queryInvalid');
  const normalized=normalizeTitleSearch(filters.prefix.trim()),bound=prefixUpperBound(normalized);if(new TextEncoder().encode(normalized).length>SEARCH_INDEX_BYTES||bound&&new TextEncoder().encode(bound).length>SEARCH_INDEX_BYTES)throw new Error('queryInvalid');
  const key=packQueryKey(filters,uid);if(cursor&&cursor.key!==key)throw new Error('queryCursor');
  const prefix=normalizeTitleSearch(filters.prefix.trim()),constraints:QueryConstraint[]=[where('status','==','ready')];
  if(filters.categoryId)constraints.push(where('categoryId','==',filters.categoryId));
  if(filters.scope==='mine')constraints.push(where('ownerId','==',uid));
  if(prefix){constraints.push(where('titleSearch','>=',prefix));const upper=prefixUpperBound(prefix);if(upper)constraints.push(where('titleSearch','<',upper));constraints.push(orderBy('titleSearch','asc'),orderBy(documentId(),'asc'));}
  else constraints.push(orderBy('createdAt','desc'),orderBy(documentId(),'desc'));
  if(cursor)constraints.push(startAfter(cursor.document));
  // Read one extra item; an exactly full final page does not advertise an empty next page.
  constraints.push(limit(pageSize+1));
  const page=await getDocsFromServer(query(collection(db,'packs'),...constraints)),docs=page.docs.slice(0,pageSize),more=page.docs.length>pageSize;
  return {packs:docs.map(d=>({...d.data(),id:d.id} as ListedPack)),cursor:more?{key,document:docs.at(-1)!}:null,more};
}

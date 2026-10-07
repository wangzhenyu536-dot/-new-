import { collection, doc, getDocFromServer, getDocsFromServer, query, runTransaction, serverTimestamp, where, type Firestore, type Timestamp, type Transaction } from 'firebase/firestore';
import { canonicalSparkCategory } from './spark-account';
import { sparkStat, writeSparkCount } from './spark-ledger';
export type SparkOperation = { kind:'deletePack'|'deleteCategory'; status:'pending'|'done'; ownerId:string; actorId:string; packId:string; sourceId:string; targetId:string; categoryId:string; expectedVersion:number; moved:number; createdAt:Timestamp; updatedAt:Timestamp; id:string };
export class SparkManagementError extends Error { constructor(public code:string){super(code);} }
const fail=(code:string):never=>{throw new SparkManagementError(code);};
const safeId=(id:string)=>typeof id==='string'&&id.length>0&&id.length<=150&&!/[/\\\p{Cc}]/u.test(id)&&id!=='.'&&id!=='..';
const operationValue=(id:string,value:Record<string,unknown>):SparkOperation=>({...value,id} as SparkOperation);
async function actor(tx:Transaction,db:Firestore,uid:string,adminOnly=false){
 const profile=await tx.get(doc(db,'users',uid));
 if(!profile.exists()||!['admin','member'].includes(profile.get('role'))||adminOnly&&profile.get('role')!=='admin')fail('forbidden');
 return profile.get('role') as string;
}
function authority(op:SparkOperation,uid:string,role:string){if(!['member','admin'].includes(role))fail('forbidden');if(op.kind==='deleteCategory'?role!=='admin':op.ownerId!==uid&&role!=='admin')fail('forbidden');}
async function protectedCall<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){if((error as {code?:string}).code==='permission-denied')fail('forbidden');throw error;}}
async function readOperation(db:Firestore,id:string):Promise<SparkOperation>{const saved=await getDocFromServer(doc(db,'sparkOperations',id));if(!saved.exists())fail('notFound');return operationValue(id,saved.data()!);}
export async function beginSparkPackDelete(db:Firestore,uid:string,packId:string,expectedVersion:number,confirmation?:string):Promise<SparkOperation>{
 if(!safeId(packId)||!safeId(uid))fail('notFound');if(confirmation!==packId)fail('confirmation');
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)fail('versionConflict');
 const id='pack-'+packId,opRef=doc(db,'sparkOperations',id),root=doc(db,'packs',packId);
 try{await protectedCall(()=>runTransaction(db,async tx=>{
  const role=await actor(tx,db,uid),receipt=await tx.get(opRef);
  if(receipt.exists()){const op=operationValue(id,receipt.data()!);authority(op,uid,role);if(op.kind!=='deletePack'||op.packId!==packId||op.expectedVersion!==expectedVersion)fail('operationChanged');return;}
  const pack=await tx.get(root);if(!pack.exists())fail('notFound');if(pack.get('ownerId')!==uid&&role!=='admin')fail('forbidden');
  if(pack.get('status')!=='ready'||pack.get('version')!==expectedVersion)fail('versionConflict');
  const categoryId=String(pack.get('categoryId'));
  const [category,stat]=await Promise.all([tx.get(doc(db,'categories',categoryId)),tx.get(doc(db,'categoryStats',categoryId))]);
  if(!category.exists()||category.get('status')!=='active')fail('categoryUnavailable');sparkStat(stat);
  tx.set(opRef,{kind:'deletePack',status:'pending',ownerId:pack.get('ownerId'),actorId:uid,packId,sourceId:'',targetId:'',categoryId:pack.get('categoryId'),expectedVersion,moved:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  tx.update(root,{status:'deleting',deletionOperation:id,updatedAt:serverTimestamp()});
 }));}catch(error){
  // Concurrent commit or a lost response is confirmed from the durable receipt.
  try{const [op,profile]=await Promise.all([readOperation(db,id),getDocFromServer(doc(db,'users',uid))]);authority(op,uid,String(profile.get('role')));if(profile.exists()&&op.kind==='deletePack'&&op.packId===packId&&op.expectedVersion===expectedVersion)return op;}catch{/* Preserve the actual failed request when no matching commit is visible. */}
  throw error;
 }return protectedCall(()=>readOperation(db,id));
}
export async function beginSparkCategoryDelete(db:Firestore,uid:string,sourceId:string,targetId='',confirmation?:string):Promise<SparkOperation>{
 if(!safeId(sourceId)||!safeId(uid))fail('notFound');
 const id='category-'+sourceId,opRef=doc(db,'sparkOperations',id),source=doc(db,'categories',sourceId);
 try{await protectedCall(()=>runTransaction(db,async tx=>{
  await actor(tx,db,uid,true);const receipt=await tx.get(opRef);
  if(receipt.exists()){const op=operationValue(id,receipt.data()!);if(op.kind!=='deleteCategory'||op.sourceId!==sourceId||op.targetId!==targetId||confirmation!==sourceId)fail('operationChanged');return;}
  const [category,stat]=await Promise.all([tx.get(source),tx.get(doc(db,'categoryStats',sourceId))]);
  if(!category.exists())fail('notFound');if(confirmation!==sourceId)fail('confirmation');
  if(category.get('status')!=='active')fail('categoryUnavailable');const count=sparkStat(stat).packCount;
  if(count>0&&!targetId)fail('targetRequired');
  let target:Awaited<ReturnType<Transaction['get']>>|undefined;
  if(targetId){if(!safeId(targetId)||sourceId===targetId)fail('categoryUnavailable');const values=await Promise.all([tx.get(doc(db,'categories',targetId)),tx.get(doc(db,'categoryStats',targetId))]);target=values[0];if(!target.exists()||target.get('status')!=='active')fail('categoryUnavailable');sparkStat(values[1]);}
  tx.set(opRef,{kind:'deleteCategory',status:'pending',ownerId:uid,actorId:uid,packId:'',sourceId,targetId,categoryId:sourceId,expectedVersion:0,moved:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  tx.update(source,{status:'migrating',operationId:id});if(target)tx.update(target.ref,{status:'locked',operationId:id});
 }));}catch(error){
  try{const [op,profile]=await Promise.all([readOperation(db,id),getDocFromServer(doc(db,'users',uid))]);if(profile.get('role')==='admin'&&op.kind==='deleteCategory'&&op.sourceId===sourceId&&op.targetId===targetId&&confirmation===sourceId)return op;}catch{/* No matching confirmed operation: keep the original failure. */}
  throw error;
 }return protectedCall(()=>readOperation(db,id));
}
export async function renameSparkCategory(db:Firestore,uid:string,categoryId:string,rawName:string,expectedName:string):Promise<{id:string;name:string}>{
 let name:string,key:string;try{({name,id:key}=canonicalSparkCategory(rawName));}catch{fail('categoryInvalid');}
 return protectedCall(()=>runTransaction(db,async tx=>{
  await actor(tx,db,uid,true);const root=doc(db,'categories',categoryId),current=await tx.get(root);
  if(!current.exists())fail('notFound');if(current.get('status')!=='active')fail('categoryUnavailable');
  const oldName=String(current.get('name')),oldKey=canonicalSparkCategory(oldName).id;
  // A lost acknowledgement confirms the same requested result; a different saved name fails closed.
  if(oldName===name)return {id:categoryId,name};if(oldName!==expectedName)fail('categoryChanged');
  const [oldRegistry,newRegistry,stat]=await Promise.all([tx.get(doc(db,'categoryKeys',oldKey)),tx.get(doc(db,'categoryKeys',key)),tx.get(doc(db,'categoryStats',categoryId))]);
  sparkStat(stat);if(!oldRegistry.exists()||oldRegistry.get('categoryId')!==categoryId)fail('baselineRequired');
  if(newRegistry.exists()&&newRegistry.get('categoryId')!==categoryId)fail('categoryExists');
  tx.update(root,{name});if(oldKey!==key){tx.delete(doc(db,'categoryKeys',oldKey));tx.set(doc(db,'categoryKeys',key),{categoryId});}return {id:categoryId,name};
 }));
}
async function resumePack(db:Firestore,uid:string,id:string,onProgress?:(value:{moved:number;phase:string})=>void){
 for(const group of [0,1]){
  let changed:boolean;try{changed=await runTransaction(db,async tx=>{
   const role=await actor(tx,db,uid),receipt=await tx.get(doc(db,'sparkOperations',id));if(!receipt.exists())fail('notFound');
   const op=operationValue(id,receipt.data()!);authority(op,uid,role);if(op.status==='done')return false;
   const root=await tx.get(doc(db,'packs',op.packId));if(!root.exists()||root.get('status')!=='deleting'||root.get('deletionOperation')!==id)fail('operationChanged');
   const groupRef=doc(db,'packs',op.packId,'groups',String(group)),saved=await tx.get(groupRef);if(!saved.exists())return false;
   const slots=saved.get('slots');if(!Array.isArray(slots)||slots.some(slot=>!Array.from({length:6},(_,n)=>String(group*6+n)).includes(slot)))fail('operationChanged');
   for(const slot of slots)tx.delete(doc(db,'packs',op.packId,'files',slot));tx.delete(groupRef);return true;
  });}catch(error){
   // Another authorized cleanup may have removed this exact group while the
   // transaction was pending. Only a fresh, authorized proof permits continuation.
   const [op,profile]=await Promise.all([readOperation(db,id),getDocFromServer(doc(db,'users',uid))]);authority(op,uid,String(profile.get('role')));
   if(op.status!=='done'){
    const [pack,saved]=await Promise.all([getDocFromServer(doc(db,'packs',op.packId)),getDocFromServer(doc(db,'packs',op.packId,'groups',String(group)))]);
    if(!pack.exists()||pack.get('status')!=='deleting'||pack.get('deletionOperation')!==id||saved.exists())throw error;
   }changed=false;
  }if(changed)onProgress?.({moved:0,phase:'group-'+group});
 }
 await runTransaction(db,async tx=>{
  const role=await actor(tx,db,uid),receipt=await tx.get(doc(db,'sparkOperations',id));if(!receipt.exists())fail('notFound');const op=operationValue(id,receipt.data()!);authority(op,uid,role);if(op.status==='done')return;
  const root=doc(db,'packs',op.packId),[pack,zero,one,stat]=await Promise.all([tx.get(root),tx.get(doc(db,'packs',op.packId,'groups','0')),tx.get(doc(db,'packs',op.packId,'groups','1')),tx.get(doc(db,'categoryStats',op.categoryId))]);
  if(!pack.exists()||pack.get('status')!=='deleting'||pack.get('deletionOperation')!==id||zero.exists()||one.exists())fail('operationChanged');
  writeSparkCount(tx,db,op.categoryId,sparkStat(stat),-1,op.packId,id,'deletePack');tx.delete(root);tx.update(receipt.ref,{status:'done',updatedAt:serverTimestamp()});
 });
}
async function resumeCategory(db:Firestore,uid:string,id:string,onProgress?:(value:{moved:number;phase:string})=>void){
 const initial=await readOperation(db,id);if(initial.status==='done')return;
 // A category lock prevents new references. Pending deletions are completed before moving ready packs.
 const roots=await getDocsFromServer(query(collection(db,'packs'),where('categoryId','==',initial.sourceId)));
 for(const saved of roots.docs){
  if(saved.get('status')==='deleting'){await resumeSparkOperation(db,uid,'pack-'+saved.id);continue;}
  const moved=await runTransaction(db,async tx=>{
   await actor(tx,db,uid,true);const receipt=await tx.get(doc(db,'sparkOperations',id));if(!receipt.exists())fail('notFound');const op=operationValue(id,receipt.data()!);if(op.status==='done')return null;
   const [pack,source,target,sourceStat,targetStat]=await Promise.all([tx.get(saved.ref),tx.get(doc(db,'categories',op.sourceId)),tx.get(doc(db,'categories',op.targetId)),tx.get(doc(db,'categoryStats',op.sourceId)),tx.get(doc(db,'categoryStats',op.targetId))]);
   if(!pack.exists()||pack.get('categoryId')!==op.sourceId)return null;
   if(pack.get('status')!=='ready')return null;
   if(source.get('operationId')!==id||source.get('status')!=='migrating'||target.get('status')!=='locked'||target.get('operationId')!==id)fail('operationChanged');
   tx.update(saved.ref,{categoryId:op.targetId,updatedAt:serverTimestamp()});
   writeSparkCount(tx,db,op.sourceId,sparkStat(sourceStat),-1,saved.id,id,'movePack');writeSparkCount(tx,db,op.targetId,sparkStat(targetStat),1,saved.id,id,'movePack');
   tx.update(receipt.ref,{moved:op.moved+1,updatedAt:serverTimestamp()});return op.moved+1;
  });if(moved!==null)onProgress?.({moved,phase:'moving'});
 }
 await runTransaction(db,async tx=>{
  await actor(tx,db,uid,true);const receipt=await tx.get(doc(db,'sparkOperations',id));if(!receipt.exists())fail('notFound');const op=operationValue(id,receipt.data()!);if(op.status==='done')return;
  const sourceRef=doc(db,'categories',op.sourceId),[source,stat]=await Promise.all([tx.get(sourceRef),tx.get(doc(db,'categoryStats',op.sourceId))]);
  if(sparkStat(stat).packCount!==0||!source.exists()||source.get('operationId')!==id)fail('operationChanged');
  const target=op.targetId?await tx.get(doc(db,'categories',op.targetId)):null;
  if(target&&(target.get('operationId')!==id||target.get('status')!=='locked'))fail('operationChanged');
  tx.delete(sourceRef);tx.delete(stat.ref);tx.delete(doc(db,'categoryKeys',canonicalSparkCategory(String(source.get('name'))).id));
  if(target){const value={...target.data()!};delete value.operationId;tx.set(target.ref,{...value,status:'active'});}
  tx.update(receipt.ref,{status:'done',updatedAt:serverTimestamp()});
 });
}
export async function resumeSparkOperation(db:Firestore,uid:string,operationId:string,onProgress?:(value:{moved:number;phase:string})=>void):Promise<{operationId:string;status:'pending'|'done';moved:number}>{
 if(!safeId(operationId)||!safeId(uid))fail('notFound');
 return protectedCall(async()=>{
  const op=await readOperation(db,operationId),profile=await getDocFromServer(doc(db,'users',uid));if(!profile.exists())fail('forbidden');authority(op,uid,String(profile.get('role')));
  try{if(op.status!=='done'){if(op.kind==='deletePack')await resumePack(db,uid,operationId,onProgress);else await resumeCategory(db,uid,operationId,onProgress);}}catch(error){
   const [receipt,freshProfile]=await Promise.all([readOperation(db,operationId),getDocFromServer(doc(db,'users',uid))]);authority(receipt,uid,String(freshProfile.get('role')));
   if(receipt.status!=='done')throw error;
  }
  const done=await readOperation(db,operationId);return {operationId,status:done.status,moved:done.moved};
 });
}

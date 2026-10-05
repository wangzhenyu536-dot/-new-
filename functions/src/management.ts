import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash, randomUUID } from 'node:crypto';
import { retryCommittedCleanup } from './uploads.js';
import { normalizeCategory, readFunctionsRegion } from '@evertrace/shared';
const region=readFunctionsRegion(process.env),stamp=()=>FieldValue.serverTimestamp();
type Bucket=ReturnType<ReturnType<typeof getStorage>['bucket']>;
export type ManagementServices={db:Firestore;bucket:Bucket;deadline?:number;deleteObject?:(path:string,generation:string)=>Promise<void>};
type Operation={kind:'deletePack'|'deleteCategory';status:'pending'|'done';packId?:string;categoryId?:string;expectedVersion?:number;sourceId?:string;targetId?:string;sourceNormalizedName?:string;ownerId?:string;moved:number;leaseUntil?:Timestamp;attempt?:string};
type Result={operationId:string;status:'pending'|'done';moved:number};
const services=():ManagementServices=>({db:getFirestore(),bucket:getStorage().bucket(process.env.EVERTRACE_STORAGE_BUCKET||undefined)});
function id(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw new HttpsError('invalid-argument','Invalid identifier.');return value;}
function failed(code:string){return new HttpsError('failed-precondition',code,{code});}
async function admin(tx:Transaction,db:Firestore,uid:string){const saved=await tx.get(db.doc('users/'+uid));if(saved.get('role')!=='admin')throw new HttpsError('permission-denied','Administrator required.');}
// Ownership is taken only from trusted pack/operation records, never from request data.
async function membership(tx:Transaction,db:Firestore,uid:string){const saved=await tx.get(db.doc('users/'+uid)),role=saved.get('role');if(!['member','admin'].includes(role))throw new HttpsError('permission-denied','Membership required.');return role;}
async function operationAccess(tx:Transaction,s:ManagementServices,uid:string,operationId:string){
 const role=await membership(tx,s.db,uid),saved=await tx.get(s.db.doc('adminOperations/'+operationId));
 if(!saved.exists){if(role!=='admin')throw new HttpsError('permission-denied','Operation unavailable.');throw failed('operationMissing');}
 if(role!=='admin'){
  let ownerId=saved.get('ownerId');
  if(saved.get('kind')==='deletePack'&&!ownerId){const pack=await tx.get(s.db.doc('packs/'+saved.get('packId')));if(pack.get('deletionOperation')===operationId)ownerId=pack.get('ownerId');}
  if(saved.get('kind')!=='deletePack'||ownerId!==uid)throw new HttpsError('permission-denied','Owner or administrator required.');
 }
 return saved;
}
async function authorizeOperation(uid:string,s:ManagementServices,operationId:string){await s.db.runTransaction(tx=>operationAccess(tx,s,uid,operationId));}
async function identity(uid:string|undefined){if(!uid)throw new HttpsError('unauthenticated','Sign in.');if((await getAuth().getUser(uid)).disabled)throw new HttpsError('permission-denied','Account unavailable.');return uid;}
async function authorize(uid:string,s:ManagementServices){await s.db.runTransaction(tx=>admin(tx,s.db,uid));}
function unlocked(category:{exists:boolean;get:(field:string)=>unknown}){if(!category.exists||category.get('status')!=='active'||category.get('incomingOperation'))throw failed('categoryUnavailable');}
const nameKey=(name:string)=>createHash('sha256').update(name).digest('hex');
export async function startPackDeletion(uid:string,data:Record<string,unknown>,s:ManagementServices){
  const {db}=s;await db.runTransaction(tx=>membership(tx,db,uid));
  const packId=id(data.packId),operationId=id(data.operationId);if(data.confirmation!==packId||!Number.isSafeInteger(data.expectedVersion)||(data.expectedVersion as number)<1)throw new HttpsError('invalid-argument','Confirm the pack and version.');
  await db.runTransaction(async tx=>{
    const role=await membership(tx,db,uid);const opRef=db.doc('adminOperations/'+operationId),saved=await tx.get(opRef);
    if(saved.exists){await operationAccess(tx,s,uid,operationId);if(saved.get('kind')!=='deletePack'||saved.get('packId')!==packId||saved.get('expectedVersion')!==data.expectedVersion)throw new HttpsError('already-exists','Operation key has another request.');return;}
    const packRef=db.doc('packs/'+packId),pack=await tx.get(packRef);if(role!=='admin'&&(!pack.exists||pack.get('ownerId')!==uid))throw new HttpsError('permission-denied','Owner or administrator required.');if(!pack.exists||pack.get('status')!=='ready')throw failed('packUnavailable');if(pack.get('version')!==data.expectedVersion)throw new HttpsError('aborted','Pack changed.',{code:'versionConflict'});
    const category=await tx.get(db.doc('categories/'+pack.get('categoryId')));unlocked(category);
    const sessions=await tx.get(db.collection('uploadSessions').where('packId','==',packId).where('status','==','validating'));
    if(sessions.docs.some(d=>(d.get('leaseUntil')?.toMillis()??0)>Date.now()))throw new HttpsError('aborted','Save in progress.',{code:'saveBusy'});
    tx.update(packRef,{status:'deleting',deletionOperation:operationId,updatedAt:stamp()});
    tx.create(opRef,{kind:'deletePack',status:'pending',packId,ownerId:pack.get('ownerId'),categoryId:pack.get('categoryId'),expectedVersion:data.expectedVersion,moved:0,createdBy:uid,createdAt:stamp(),updatedAt:stamp()});
    tx.create(db.doc('cleanupJobs/'+operationId),{kind:'deletePack',operationId,packId,status:'pending',updatedAt:stamp()});
  });return operationId;
}
export async function startCategoryDeletion(uid:string,data:Record<string,unknown>,s:ManagementServices){
  const {db}=s;await authorize(uid,s);
  const sourceId=id(data.sourceId),operationId=id(data.operationId),targetId=data.targetId?id(data.targetId):'';if(data.confirmation!==sourceId||sourceId===targetId)throw new HttpsError('invalid-argument','Confirm a distinct source category.');
  await db.runTransaction(async tx=>{
    await admin(tx,db,uid);const opRef=db.doc('adminOperations/'+operationId),saved=await tx.get(opRef);
    if(saved.exists){if(saved.get('kind')!=='deleteCategory'||saved.get('sourceId')!==sourceId||(saved.get('targetId')||'')!==targetId)throw new HttpsError('already-exists','Operation key has another request.');return;}
    const sourceRef=db.doc('categories/'+sourceId),source=await tx.get(sourceRef);unlocked(source);
    const refs=await tx.get(db.collection('packs').where('categoryId','==',sourceId).limit(1));
    const deleting=await tx.get(db.collection('packs').where('categoryId','==',sourceId).where('status','==','deleting').limit(1));if(!deleting.empty)throw failed('deletePending');
    if(!refs.empty&&!targetId)throw failed('targetRequired');
    const target=targetId?await tx.get(db.doc('categories/'+targetId)):null;if(target)unlocked(target);
    const name=String(source.get('normalizedName')??normalizeCategory(source.get('name')).normalizedName);
    tx.update(sourceRef,{status:'migrating',deletionOperation:operationId,updatedAt:stamp()});if(target)tx.update(target.ref,{incomingOperation:operationId,updatedAt:stamp()});
    tx.create(opRef,{kind:'deleteCategory',status:'pending',sourceId,targetId,sourceNormalizedName:name,moved:0,createdBy:uid,createdAt:stamp(),updatedAt:stamp()});
    tx.create(db.doc('cleanupJobs/'+operationId),{kind:'deleteCategory',sourceId,targetId,operationId,status:'pending',updatedAt:stamp()});
  });return operationId;
}
async function current(tx:Transaction,s:ManagementServices,uid:string,operationId:string,attempt:string){const op=await operationAccess(tx,s,uid,operationId);if(op.get('status')!=='pending'||op.get('attempt')!==attempt)throw failed('operationBusy');return op;}
async function removePrefix(prefix:string,s:ManagementServices,uid:string,operationId:string){
  await authorizeOperation(uid,s,operationId);const [objects]=await s.bucket.getFiles({prefix,maxResults:100,autoPaginate:false});
  for(const object of objects){if(Date.now()>(s.deadline??Infinity))throw failed('cleanupPending');await authorizeOperation(uid,s,operationId);try{const [metadata]=await object.getMetadata();if(s.deleteObject)await s.deleteObject(object.name,String(metadata.generation));else await object.delete({ifGenerationMatch:metadata.generation});}catch(error){if((error as {code?:number}).code!==404)throw error;}}
  if((await s.bucket.getFiles({prefix,maxResults:1,autoPaginate:false}))[0].length)throw failed('cleanupPending');
}
async function deletePackBatch(uid:string,operationId:string,attempt:string,op:Operation,s:ManagementServices):Promise<boolean>{
  const {db}=s,packId=op.packId!;
  // Close planned staging writes before enumerating objects. A live validator was rejected at the initial lock.
  const closed=await db.runTransaction(async tx=>{await current(tx,s,uid,operationId,attempt);const sessions=await tx.get(db.collection('uploadSessions').where('packId','==',packId).where('status','in',['accepting','validating']).limit(100));for(const session of sessions.docs)tx.update(session.ref,{status:'deleting',updatedAt:stamp()});return sessions.size;});
  if(closed===100)return false;
  await removePrefix('packs/'+packId+'/',s,uid,operationId);
  const sessions=await db.collection('uploadSessions').where('packId','==',packId).limit(75).get();
  for(const session of sessions.docs){const actorId=id(session.get('actorId'));await removePrefix(`staging/${actorId}/${session.id}/`,s,uid,operationId);}
  await db.runTransaction(async tx=>{await current(tx,s,uid,operationId,attempt);for(const session of sessions.docs){tx.delete(session.ref);tx.delete(db.doc('cleanupJobs/'+session.id));}});
  const files=await db.collection(`packs/${packId}/files`).limit(100).get();await db.runTransaction(async tx=>{await current(tx,s,uid,operationId,attempt);for(const file of files.docs)tx.delete(file.ref);});
  if(sessions.size===75||files.size===100)return false;
  return db.runTransaction(async tx=>{
    await current(tx,s,uid,operationId,attempt);const packRef=db.doc('packs/'+packId),pack=await tx.get(packRef),category=await tx.get(db.doc('categories/'+op.categoryId));const remaining=await tx.get(db.collection('uploadSessions').where('packId','==',packId).limit(1)),attachments=await tx.get(db.collection(`packs/${packId}/files`).limit(1));
    if(!remaining.empty||!attachments.empty)return false;
    if(!pack.exists||pack.get('status')!=='deleting'||pack.get('deletionOperation')!==operationId||!category.exists||category.get('packCount')<1)throw failed('cleanupPending');
    tx.create(db.doc('deletedPacks/'+packId),{operationId,deletedAt:stamp()});tx.delete(packRef);tx.update(category.ref,{packCount:FieldValue.increment(-1),updatedAt:stamp()});tx.delete(db.doc('cleanupJobs/'+operationId));tx.update(db.doc('adminOperations/'+operationId),{status:'done',attempt:FieldValue.delete(),leaseUntil:FieldValue.delete(),lastError:FieldValue.delete(),updatedAt:stamp()});return true;
  });
}
async function migrateBatch(uid:string,operationId:string,attempt:string,op:Operation,s:ManagementServices):Promise<boolean>{
  const {db}=s;
  return db.runTransaction(async tx=>{
    const saved=await current(tx,s,uid,operationId,attempt),source=await tx.get(db.doc('categories/'+op.sourceId)),target=op.targetId?await tx.get(db.doc('categories/'+op.targetId)):null;
    if(source.get('status')!=='migrating'||source.get('deletionOperation')!==operationId||target&&(target.get('status')!=='active'||target.get('incomingOperation')!==operationId))throw failed('categoryUnavailable');
    const packs=await tx.get(db.collection('packs').where('categoryId','==',op.sourceId).select('categoryId','status','version').limit(75));
    if(!packs.empty){if(!target||packs.docs.some(p=>p.get('status')!=='ready'))throw failed('categoryUnavailable');for(const p of packs.docs)tx.update(p.ref,{categoryId:op.targetId,version:FieldValue.increment(1),updatedAt:stamp(),updatedBy:uid});tx.update(source.ref,{packCount:FieldValue.increment(-packs.size),updatedAt:stamp()});tx.update(target.ref,{packCount:FieldValue.increment(packs.size),updatedAt:stamp()});tx.update(saved.ref,{moved:FieldValue.increment(packs.size),updatedAt:stamp()});return false;}
    if(source.get('packCount')!==0)throw failed('categoryCountMismatch');const index=await tx.get(db.doc('categoryNames/'+nameKey(op.sourceNormalizedName!)));if(index.exists&&index.get('categoryId')!==op.sourceId)throw failed('categoryUnavailable');
    tx.delete(source.ref);if(index.exists)tx.delete(index.ref);if(target)tx.update(target.ref,{incomingOperation:FieldValue.delete(),updatedAt:stamp()});tx.delete(db.doc('cleanupJobs/'+operationId));tx.update(saved.ref,{status:'done',attempt:FieldValue.delete(),leaseUntil:FieldValue.delete(),lastError:FieldValue.delete(),updatedAt:stamp()});return true;
  });
}
export async function advanceOperation(uid:string,operationId:string,s:ManagementServices):Promise<Result>{
  id(operationId);s={...s,deadline:Date.now()+80000};await authorizeOperation(uid,s,operationId);const attempt=randomUUID(),ref=s.db.doc('adminOperations/'+operationId);
  const op=await s.db.runTransaction(async tx=>{const saved=await operationAccess(tx,s,uid,operationId);const data=saved.data() as Operation;if(data.status==='done')return data;if((data.leaseUntil?.toMillis()??0)>Date.now())throw new HttpsError('aborted','Operation in progress.',{code:'operationBusy'});tx.update(ref,{attempt,leaseUntil:Timestamp.fromMillis(Date.now()+180000),updatedAt:stamp()});return data;});
  if(op.status==='done')return {operationId,status:'done',moved:op.moved};
  try{
    for(let batch=0;batch<3;batch++){if(Date.now()>s.deadline!)break;await authorizeOperation(uid,s,operationId);const done=op.kind==='deletePack'?await deletePackBatch(uid,operationId,attempt,op,s):await migrateBatch(uid,operationId,attempt,op,s);if(done){const result=await ref.get();return {operationId,status:'done',moved:result.get('moved')??0};}}
    await ref.update({attempt:FieldValue.delete(),leaseUntil:FieldValue.delete(),updatedAt:stamp()});
  }catch(error){await s.db.runTransaction(async tx=>{const saved=await tx.get(ref);if(saved.get('attempt')===attempt)tx.update(ref,{attempt:FieldValue.delete(),leaseUntil:FieldValue.delete(),lastError:'cleanupPending',updatedAt:stamp()});});if(error instanceof HttpsError&&error.code==='permission-denied')throw error;}
  const saved=await ref.get();return {operationId,status:'pending',moved:saved.get('moved')??0};
}
export const deletePack=onCall({region,timeoutSeconds:120},async request=>{const uid=await identity(request.auth?.uid),s=services(),operationId=await startPackDeletion(uid,request.data??{},s);return advanceOperation(uid,operationId,s);});
export const deleteCategory=onCall({region,timeoutSeconds:120},async request=>{const uid=await identity(request.auth?.uid),s=services(),operationId=await startCategoryDeletion(uid,request.data??{},s);return advanceOperation(uid,operationId,s);});
export const retryCleanup=onCall({region,timeoutSeconds:120},async request=>{const uid=await identity(request.auth?.uid),s=services();const operationId=id(request.data?.operationId);if(!(await s.db.doc('adminOperations/'+operationId).get()).exists){await authorize(uid,s);return retryCommittedCleanup(uid,operationId);}return advanceOperation(uid,operationId,s);});
export const renameCategory=onCall({region},async request=>{
  const uid=await identity(request.auth?.uid),s=services(),{db}=s;await authorize(uid,s);const categoryId=id(request.data?.categoryId);let normalized:ReturnType<typeof normalizeCategory>;try{normalized=normalizeCategory(request.data?.name);}catch{throw new HttpsError('invalid-argument','Invalid category name.');}
  return db.runTransaction(async tx=>{await admin(tx,db,uid);const saved=await tx.get(db.doc('categories/'+categoryId));unlocked(saved);if(request.data?.expectedName!==undefined&&request.data.expectedName!==saved.get('name'))throw new HttpsError('aborted','Category changed.',{code:'versionConflict'});const next=db.doc('categoryNames/'+nameKey(normalized.normalizedName)),old=db.doc('categoryNames/'+nameKey(String(saved.get('normalizedName')??normalizeCategory(saved.get('name')).normalizedName))),index=await tx.get(next);if(index.exists&&index.get('categoryId')!==categoryId)throw new HttpsError('already-exists','Category name exists.');if(old.path!==next.path){const previous=await tx.get(old);if(previous.exists&&previous.get('categoryId')===categoryId)tx.delete(old);}tx.set(next,{categoryId,normalizedName:normalized.normalizedName});tx.update(saved.ref,{...normalized,updatedAt:stamp()});return {id:categoryId,name:normalized.name};});
});

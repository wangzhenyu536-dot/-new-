import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash, randomUUID } from 'node:crypto';
import { PREVIEW_LIMITS, UPLOAD_POLICY, readFunctionsRegion, validateEeg, validateText, validatePackInput, type BeginUploadInput, type PlannedFile, type StoredFile, type UploadSession } from '@evertrace/shared';
const region=readFunctionsRegion(process.env);
const db=()=>getFirestore(), bucket=()=>getStorage().bucket(process.env.EVERTRACE_STORAGE_BUCKET || undefined);
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
type Session=UploadSession & BeginUploadInput & {actorId:string;ownerName:string;fingerprint:string;status:string;expiresAt:Timestamp;leaseUntil?:Timestamp;attempt?:string;cleanupPending?:boolean};
function error(code:string,details:Record<string,unknown>={}) { return new HttpsError('failed-precondition',code,{code,...details}); }
function id(value:unknown):string {if(typeof value!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(value))throw new HttpsError('invalid-argument','Invalid identifier.');return value;}
async function account(uid:string|undefined) {if(!uid)throw new HttpsError('unauthenticated','Sign in.');const user=await getAuth().getUser(uid);if(user.disabled)throw new HttpsError('permission-denied','Account unavailable.');return user;}
async function member(tx:Transaction,uid:string) {const profile=await tx.get(db().doc('users/'+uid));if(!profile.exists||!['member','admin'].includes(profile.get('role')))throw new HttpsError('permission-denied','A member profile is required.');return profile;}
function parse(value:unknown):BeginUploadInput {
  const data=value as Partial<BeginUploadInput>;
  if(!data||typeof data!=='object'||Array.isArray(data)||'packId' in data||'expectedVersion' in data||typeof data.title!=='string'||typeof data.textContent!=='string'||!Array.isArray(data.filePlan)||data.filePlan.length<1||data.filePlan.length>2)throw new HttpsError('invalid-argument','Invalid upload plan.');
  const requestId=id(data.requestId),categoryId=id(data.categoryId),title=data.title.trim(),textContent=data.textContent;
  const filePlan=data.filePlan.map(file=>{
    if(!file||!['text','eeg'].includes(file.kind)||typeof file.name!=='string'||file.name.length>160||!file.name.trim()||/[\\/:]/.test(file.name)||file.name==='.'||file.name==='..'||[...file.name].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)||!new RegExp(file.kind==='text'?'\\.txt$':'\\.xlsx$','i').test(file.name)||!Number.isSafeInteger(file.size)||file.size<=0||file.size>(file.kind==='text'?PREVIEW_LIMITS.textBytes:PREVIEW_LIMITS.excelBytes)||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256))throw new HttpsError('invalid-argument','Invalid attachment.');
    return {kind:file.kind,name:file.name,size:file.size,sha256:file.sha256};
  });
  if(filePlan.filter(f=>f.kind==='eeg').length!==1||filePlan.filter(f=>f.kind==='text').length>1||validatePackInput({title,categoryId,text:textContent,textFileValid:filePlan.some(f=>f.kind==='text'),eegValid:true}).length)throw new HttpsError('invalid-argument','Required material is missing or too long.');
  return {requestId,title,categoryId,textContent,filePlan};
}
function response(s:Session):UploadSession {return {sessionId:s.sessionId,packId:s.packId,files:s.files,status:s.status,...(s.status==='committed'?{result:{packId:s.packId,cleanupPending:Boolean(s.cleanupPending)}}:{})};}
export const beginUpload=onCall({region},async request=>{
  const user=await account(request.auth?.uid),input=parse(request.data),fingerprint=sha(JSON.stringify(input)),sessionId=sha(user.uid+':'+input.requestId),packId=sessionId;
  const sessionRef=db().doc('uploadSessions/'+sessionId);
  return db().runTransaction(async tx=>{
    const [profile,saved,category]=await Promise.all([member(tx,user.uid),tx.get(sessionRef),tx.get(db().doc('categories/'+input.categoryId))]);
    if(saved.exists){const session=saved.data() as Session;if(session.actorId!==user.uid)throw new HttpsError('permission-denied','Upload owner mismatch.');if(session.fingerprint!==fingerprint)throw new HttpsError('already-exists','This request key has a different plan.',{code:'requestChanged'});if(['cancelled','expired'].includes(session.status)||session.expiresAt.toMillis()<=Date.now()&&session.status!=='committed')throw error('sessionExpired');return response(session);}
    if(!category.exists||category.get('status')!=='active')throw error('categoryUnavailable');
    const files=input.filePlan.map(file=>{const fileId=randomUUID(),ext=file.kind==='text'?'txt':'xlsx';return {...file,id:fileId,mediaType:UPLOAD_POLICY.mediaTypes[file.kind],stagingPath:`staging/${user.uid}/${sessionId}/${fileId}.${ext}`,storagePath:`packs/${packId}/files/${fileId}.${ext}`};});
    const fileMap=Object.fromEntries(files.map(file=>[file.id+'.'+(file.kind==='text'?'txt':'xlsx'),{size:file.size,mediaType:file.mediaType}]));
    const session:Session={...input,sessionId,packId,files,fingerprint,actorId:user.uid,ownerName:profile.get('displayName')||user.email||'',status:'accepting',expiresAt:Timestamp.fromMillis(Date.now()+UPLOAD_POLICY.lifetimeMs)};
    tx.create(sessionRef,{...session,fileMap,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});return response(session);
  });
});
async function removePaths(sessionId:string,paths:string[]) {
  let failed=false;
  for(const path of paths){try{const object=bucket().file(path);const [metadata]=await object.getMetadata();await object.delete({ifGenerationMatch:metadata.generation});}catch(e){if((e as {code?:number}).code!==404)failed=true;}}
  const job=db().doc('cleanupJobs/'+sessionId);
  if(failed)await job.set({sessionId,paths,status:'pending',lastError:'storageCleanup',updatedAt:FieldValue.serverTimestamp()},{merge:true});else await job.delete();
  return failed;
}
async function cleanCommitted(session:Session){const pending=await removePaths(session.sessionId,session.files.map(f=>f.stagingPath));const updates=db().batch();updates.update(db().doc('uploadSessions/'+session.sessionId),{cleanupPending:pending});updates.update(db().doc('packs/'+session.packId),{cleanupPending:pending});await updates.commit();return {packId:session.packId,cleanupPending:pending};}
async function readOriginal(file:PlannedFile){
  const object=bucket().file(file.stagingPath);let metadata;
  try{[metadata]=await object.getMetadata();}catch(e){if((e as {code?:number}).code===404)throw error('uploadIncomplete',{file:file.name});throw e;}
  if(Number(metadata.size)!==file.size||metadata.contentType!==file.mediaType||metadata.contentEncoding&&metadata.contentEncoding!=='identity'||!metadata.generation)throw new HttpsError('invalid-argument','Uploaded file differs from plan.',{code:'fileChanged',file:file.name});
  // Pin the read to the inspected immutable generation, including in real Cloud Storage.
  const [bytes]=await bucket().file(file.stagingPath,{generation:metadata.generation}).download({start:0,end:file.size,decompress:false});
  if(bytes.length!==file.size||sha(bytes)!==file.sha256)throw new HttpsError('invalid-argument','Uploaded bytes differ from plan.',{code:'fileChanged',file:file.name});
  return {bytes,generation:metadata.generation};
}
export const savePack=onCall({region,memory:'1GiB',timeoutSeconds:120,concurrency:4},async request=>{
  const user=await account(request.auth?.uid),sessionId=id(request.data?.sessionId),sessionRef=db().doc('uploadSessions/'+sessionId),attempt=randomUUID();
  const session=await db().runTransaction(async tx=>{
    await member(tx,user.uid);const saved=await tx.get(sessionRef);if(!saved.exists)throw error('sessionExpired');const s=saved.data() as Session;
    if(s.actorId!==user.uid)throw new HttpsError('permission-denied','Only the upload owner can save.');
    if(s.status==='committed')return s;
    if(['cancelled','expired'].includes(s.status)||s.expiresAt.toMillis()<=Date.now())throw error('sessionExpired');
    const category=await tx.get(db().doc('categories/'+s.categoryId));if(!category.exists||category.get('status')!=='active')throw error('categoryUnavailable');
    if(s.status==='validating'&&(s.leaseUntil?.toMillis()??0)>Date.now())throw new HttpsError('aborted','Save in progress.',{code:'saveBusy'});
    if(!['accepting','validating'].includes(s.status))throw error('sessionExpired');
    tx.update(sessionRef,{status:'validating',attempt,leaseUntil:Timestamp.fromMillis(Date.now()+UPLOAD_POLICY.leaseMs),updatedAt:FieldValue.serverTimestamp()});return {...s,status:'validating',attempt};
  });
  if(session.status==='committed')return cleanCommitted(session);
  try{
    const originals=[];
    for(const file of session.files){const original=await readOriginal(file);const result=file.kind==='eeg'?await validateEeg(original.bytes,file.name):validateText(original.bytes,file.name);if(!result.ok)throw new HttpsError('invalid-argument','File validation failed.',{code:'validationFailed',issues:result.issues});originals.push({file,...original,eegSummary:file.kind==='eeg'&&'summary' in result?result.summary:undefined});}
    const invalid=validatePackInput({title:session.title,categoryId:session.categoryId,text:session.textContent,textFileValid:originals.some(x=>x.file.kind==='text'),eegValid:originals.some(x=>x.file.kind==='eeg')});if(invalid.length)throw new HttpsError('invalid-argument','Material validation failed.',{code:'validationFailed',issues:invalid});
    const stored:StoredFile[]=[];
    for(const original of originals){
      const {file,bytes,generation,eegSummary}=original,object=bucket().file(file.storagePath);
      const [exists]=await object.exists();
      if(exists){const [existing]=await object.download();if(existing.length!==file.size||sha(existing)!==file.sha256)throw error('copyFailed',{file:file.name});}
      try{if(!exists)await object.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:file.mediaType,metadata:{sha256:file.sha256,sourceGeneration:generation,sessionId,firebaseStorageDownloadTokens:''}}});}
      catch(e){if((e as {code?:number}).code!==412)throw e;const [existing]=await object.download();if(existing.length!==file.size||sha(existing)!==file.sha256)throw error('copyFailed',{file:file.name});}
      const [metadata]=await object.getMetadata();if(Number(metadata.size)!==file.size||metadata.contentType!==file.mediaType||metadata.metadata?.firebaseStorageDownloadTokens)throw error('copyFailed',{file:file.name});
      stored.push({id:file.id,kind:file.kind,originalName:file.name,storagePath:file.storagePath,mediaType:file.mediaType,size:file.size,sha256:file.sha256,generation:String(metadata.generation),active:true,...(eegSummary?{eegSummary}: {})});
    }
    // No client can write either path; check source generations again before publishing references.
    for(const original of originals){const [metadata]=await bucket().file(original.file.stagingPath).getMetadata();if(metadata.generation!==original.generation)throw error('fileChanged',{file:original.file.name});}
    await account(user.uid);
    await db().runTransaction(async tx=>{
      const [profile,current,category]=await Promise.all([member(tx,user.uid),tx.get(sessionRef),tx.get(db().doc('categories/'+session.categoryId))]);
      if(current.get('status')!=='validating'||current.get('attempt')!==attempt||current.get('expiresAt').toMillis()<=Date.now())throw error('sessionExpired');
      if(!category.exists||category.get('status')!=='active')throw error('categoryUnavailable');
      const stamp=FieldValue.serverTimestamp();
      tx.create(db().doc('packs/'+session.packId),{title:session.title,titleSearch:session.title.normalize('NFKC').toLowerCase(),categoryId:session.categoryId,ownerId:user.uid,ownerName:profile.get('displayName')||user.email||'',textContent:session.textContent,status:'ready',version:1,uploadSessionId:sessionId,cleanupPending:true,fileAccess:Object.fromEntries(stored.map(f=>[f.id,{active:f.active,storagePath:f.storagePath,size:f.size,mediaType:f.mediaType}])),textFileCount:stored.filter(f=>f.kind==='text').length,eegCount:1,imageCount:0,totalBytes:stored.reduce((n,f)=>n+f.size,0),createdAt:stamp,updatedAt:stamp,updatedBy:user.uid});
      for(const file of stored)tx.create(db().doc(`packs/${session.packId}/files/${file.id}`),{...file,createdAt:stamp});
      tx.update(db().doc('categories/'+session.categoryId),{packCount:FieldValue.increment(1),updatedAt:stamp});
      tx.update(sessionRef,{status:'committed',result:{packId:session.packId},cleanupPending:true,updatedAt:stamp});
    });
  }catch(e){await db().runTransaction(async tx=>{const current=await tx.get(sessionRef);if(current.get('status')==='validating'&&current.get('attempt')===attempt)tx.update(sessionRef,{status:'accepting',lastError:e instanceof HttpsError?e.details:{code:'saveFailed'},updatedAt:FieldValue.serverTimestamp()});});if(e instanceof HttpsError)throw e;throw new HttpsError('unavailable','Could not save.',{code:'saveFailed'});}
  // Publication already succeeded: cleanup failure must never become a false save failure.
  try{return await cleanCommitted(session);}catch{return {packId:session.packId,cleanupPending:true};}
});
async function closeSession(sessionId:string,actorId?:string){
  const session=await db().runTransaction(async tx=>{
    const current=await tx.get(db().doc('uploadSessions/'+sessionId));if(!current.exists)return null;const s=current.data() as Session;
    if(actorId&&s.actorId!==actorId)throw new HttpsError('permission-denied','Only the upload owner can cancel.');
    if(s.status==='committed')return s;
    if(s.status==='validating'&&(s.leaseUntil?.toMillis()??0)>Date.now())throw new HttpsError('aborted','Save in progress.',{code:'saveBusy'});
    tx.update(current.ref,{status:actorId?'cancelled':'expired',updatedAt:FieldValue.serverTimestamp()});return s;
  });
  if(!session)return {cleanupPending:false};const paths=session.files.flatMap(f=>session.status==='committed'?[f.stagingPath]:[f.stagingPath,f.storagePath]);return {cleanupPending:await removePaths(sessionId,paths)};
}
export const cancelUpload=onCall({region},async request=>{const user=await account(request.auth?.uid);await db().runTransaction(tx=>member(tx,user.uid));return closeSession(id(request.data?.sessionId),user.uid);});
// Manual maintenance only: no scheduler, no browser lifecycle dependence.
export async function cleanExpiredUploads(){
  let cleaned=0,pending=0;
  const expired=await db().collection('uploadSessions').where('status','in',['accepting','validating','cancelled','expired']).where('expiresAt','<=',Timestamp.now()).limit(100).get();
  for(const session of expired.docs){try{const result=await closeSession(session.id);if(result.cleanupPending)pending++;else{await session.ref.delete();cleaned++;}}catch{pending++;}}
  const committed=await db().collection('uploadSessions').where('cleanupPending','==',true).limit(100).get();
  for(const session of committed.docs){if(session.get('status')!=='committed')continue;try{const result=await cleanCommitted(session.data() as Session);if(result.cleanupPending)pending++;}catch{pending++;}}
  const jobs=await db().collection('cleanupJobs').limit(100).get();for(const job of jobs.docs){if(await removePaths(job.id,job.get('paths') as string[]))pending++;}
  return {cleaned,pending};
}
export const cleanupUploads=onCall({region,timeoutSeconds:120},async request=>{const user=await account(request.auth?.uid);await db().runTransaction(async tx=>{const p=await member(tx,user.uid);if(p.get('role')!=='admin')throw new HttpsError('permission-denied','Administrator required.');});return cleanExpiredUploads();});

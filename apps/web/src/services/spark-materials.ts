import {PREVIEW_LIMITS,ATTACHMENT_LIMITS,validateText,validateEeg,validatePackInput,checkImageHeader,normalizeTitleSearch,type EegResult,type Issue,type FileKind} from '@evertrace/shared';
import {Bytes,Timestamp,collection,doc,getDocFromServer,getDocsFromServer,query,runTransaction,serverTimestamp,where,orderBy,type Firestore} from 'firebase/firestore';
export const SPARK_LIMITS={fileBytes:512*1024,totalBytes:3*1024*1024,count:12};
export type SparkInput={title:string;categoryId:string;textContent:string;attachments:{file:File;kind:FileKind}[]};
export type SparkFileMeta={slot:string;kind:FileKind;name:string;mediaType:string;size:number;sha256:string};
export type PreparedSparkSave={title:string;categoryId:string;textContent:string;files:(SparkFileMeta&{bytes:Uint8Array})[];submissionHash:string};
export type SparkPack={id:string;title:string;titleSearch:string;textContent:string;ownerId:string;ownerName:string;categoryId:string;version:number;status:'ready';totalBytes:number;textFileCount:number;imageCount:number;eegCount:number;submissionHash:string;createdAt:Timestamp;updatedAt:Timestamp};
export type SparkAttempt={packId:string;submissionHash:string;uid:string};
export type SparkProgress={phase:'preparing'|'committing';file?:string;percent?:number};
export type SparkPreparationDependencies={parseEeg?:(bytes:Uint8Array,name:string,signal:AbortSignal)=>Promise<EegResult>;checkImage?:(file:File)=>Promise<boolean>};
export class SparkMaterialError extends Error {constructor(public code:string,public issues:Issue[]=[]){super(code);}}
export async function sparkDigest(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice().buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function checkSparkImage(file:File){try{const bitmap=await createImageBitmap(file),valid=bitmap.width>0&&bitmap.height>0&&bitmap.width*bitmap.height<=ATTACHMENT_LIMITS.imagePixels;bitmap.close();return valid;}catch{return false;}}
function mediaType(kind:FileKind,name:string){return kind==='text'?'text/plain':kind==='eeg'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':/\.png$/i.test(name)?'image/png':/\.webp$/i.test(name)?'image/webp':'image/jpeg';}
function safeFileName(name:string){return !!name&&name.length<=160&&!/[/\\]/.test(name)&&![...name].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127);}
function meta(file:SparkFileMeta){return {kind:file.kind,name:file.name,mediaType:file.mediaType,size:file.size,sha256:file.sha256};}
export async function prepareSparkMaterials(input:SparkInput,signal:AbortSignal,onProgress?:(value:SparkProgress)=>void,dependencies:SparkPreparationDependencies={}):Promise<PreparedSparkSave>{
 signal.throwIfAborted();const files:PreparedSparkSave['files']=[],issues:Issue[]=[];
 if(input.attachments.length>SPARK_LIMITS.count||input.attachments.reduce((n,a)=>n+a.file.size,0)>SPARK_LIMITS.totalBytes)issues.push({code:'sparkAttachmentLimit'});
 for(const {file} of input.attachments){if(file.size>SPARK_LIMITS.fileBytes)issues.push({code:'sparkFileSize',file:file.name});if(!safeFileName(file.name))issues.push({code:'fileName',file:file.name});}
 if(issues.length)throw new SparkMaterialError('validation',issues);
 onProgress?.({phase:'preparing',percent:0});
 for(const [index,{file,kind}] of input.attachments.entries()){
  signal.throwIfAborted();onProgress?.({phase:'preparing',file:file.name,percent:Math.round(index/input.attachments.length*100)});
  try{
   const bytes=new Uint8Array(await file.arrayBuffer());signal.throwIfAborted();let found:Issue[]=[];
   if(bytes.length!==file.size)found=[{code:'fileRead',file:file.name}];
   else if(kind==='text')found=validateText(bytes,file.name).issues;
   else if(kind==='image'){found=checkImageHeader(bytes,file.name);if(!found.length&&!await (dependencies.checkImage??checkSparkImage)(file))found=[{code:'imageInvalid',file:file.name}];}
   else if(kind==='eeg'){const parsed=dependencies.parseEeg?await dependencies.parseEeg(bytes.slice(),file.name,signal):await validateEeg(bytes,file.name,{...PREVIEW_LIMITS,excelBytes:SPARK_LIMITS.fileBytes});found=parsed.issues;if(!parsed.ok&&!found.length)found=[{code:'fileRead',file:file.name}];}
   else found=[{code:'fileType',file:file.name}];
   signal.throwIfAborted();issues.push(...found);if(!found.length){const sha256=await sparkDigest(bytes);signal.throwIfAborted();files.push({slot:String(index),kind,name:file.name,mediaType:mediaType(kind,file.name),size:bytes.length,sha256,bytes});}
  }catch(error){signal.throwIfAborted();if(error instanceof SparkMaterialError)issues.push(...error.issues);else issues.push({code:'fileRead',file:file.name});}
 }
 issues.push(...validatePackInput({title:input.title,categoryId:input.categoryId,text:input.textContent,textFileValid:files.some(f=>f.kind==='text'),eegValid:files.some(f=>f.kind==='eeg')}));
 if(issues.length)throw new SparkMaterialError('validation',issues);signal.throwIfAborted();
 const prepared={title:input.title.trim(),categoryId:input.categoryId,textContent:input.textContent,files};
 const submissionHash=await sparkDigest(new TextEncoder().encode(JSON.stringify({...prepared,files:files.map(file=>({slot:file.slot,...meta(file)}))})));signal.throwIfAborted();
 onProgress?.({phase:'preparing',percent:100});return {...prepared,submissionHash};
}
function groupsFor(files:SparkFileMeta[],version:number){return [0,1].map(index=>{const selected=files.filter(file=>Number(file.slot)>=index*6&&Number(file.slot)<(index+1)*6);return {version,slots:selected.map(f=>f.slot),totalBytes:selected.reduce((n,f)=>n+f.size,0),textCount:selected.filter(f=>f.kind==='text').length,imageCount:selected.filter(f=>f.kind==='image').length,eegCount:selected.filter(f=>f.kind==='eeg').length,files:Object.fromEntries(selected.map(f=>[f.slot,meta(f)]))};});}
export async function saveSparkMaterials(db:Firestore,uid:string,input:SparkInput,attempt:{current:SparkAttempt|null},onProgress:(value:SparkProgress)=>void,signal:AbortSignal,dependencies?:SparkPreparationDependencies):Promise<{packId:string}>{
 const prepared=await prepareSparkMaterials(input,signal,onProgress,dependencies);signal.throwIfAborted();
 if(!attempt.current||attempt.current.uid!==uid||attempt.current.submissionHash!==prepared.submissionHash)attempt.current={packId:crypto.randomUUID(),submissionHash:prepared.submissionHash,uid};
 const {packId}=attempt.current,root=doc(db,'packs',packId),groups=groupsFor(prepared.files,1);
 // Cancellation is truthful only before the atomic commit starts. A failed response
 // retains the attempt ID so a subsequent transaction can confirm the saved result.
 onProgress({phase:'committing'});signal.throwIfAborted();
 try{return await runTransaction(db,async transaction=>{
  const saved=await transaction.get(root);
  if(saved.exists()){if(saved.get('ownerId')!==uid||saved.get('submissionHash')!==prepared.submissionHash||saved.get('status')!=='ready')throw new SparkMaterialError('attemptConflict');return {packId};}
  const [profile,category]=await Promise.all([transaction.get(doc(db,'users',uid)),transaction.get(doc(db,'categories',prepared.categoryId))]);
  if(!profile.exists()||!['member','admin'].includes(profile.get('role')))throw new SparkMaterialError('accountProfile');
  if(!category.exists()||category.get('status')!=='active')throw new SparkMaterialError('categoryUnavailable');
  transaction.set(root,{title:prepared.title,titleSearch:normalizeTitleSearch(prepared.title),textContent:prepared.textContent,ownerId:uid,ownerName:profile.get('displayName'),categoryId:prepared.categoryId,version:1,status:'ready',totalBytes:prepared.files.reduce((n,f)=>n+f.size,0),textFileCount:prepared.files.filter(f=>f.kind==='text').length,imageCount:prepared.files.filter(f=>f.kind==='image').length,eegCount:prepared.files.filter(f=>f.kind==='eeg').length,submissionHash:prepared.submissionHash,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  groups.forEach((group,index)=>transaction.set(doc(db,'packs',packId,'groups',String(index)),group));
  for(const file of prepared.files)transaction.set(doc(db,'packs',packId,'files',file.slot),{slot:file.slot,version:1,...meta(file),bytes:Bytes.fromUint8Array(file.bytes)});
  return {packId};
 });}catch(error){
  // A concurrent successful commit or lost acknowledgement can be reported as an
  // error. Confirm the immutable original attempt without allowing an overwrite.
  try{const saved=await getDocFromServer(root);if(saved.exists()&&saved.get('status')==='ready'&&saved.get('ownerId')===uid&&saved.get('submissionHash')===prepared.submissionHash)return {packId};}catch{/* Keep the original failure when confirmation is unavailable. */}
  throw error;
 }
}
function validMeta(data:unknown):data is Omit<SparkFileMeta,'slot'>{
 if(!data||typeof data!=='object')return false;const value=data as Record<string,unknown>;
 return Object.keys(value).sort().join(',')==='kind,mediaType,name,sha256,size'&&['text','image','eeg'].includes(String(value.kind))&&typeof value.name==='string'&&safeFileName(value.name)&&typeof value.mediaType==='string'&&value.mediaType===mediaType(value.kind as FileKind,value.name)&&typeof value.size==='number'&&Number.isInteger(value.size)&&value.size>0&&value.size<=SPARK_LIMITS.fileBytes&&typeof value.sha256==='string'&&/^[0-9a-f]{64}$/.test(value.sha256);
}
function packData(data:Record<string,unknown>,id:string):SparkPack{
 if(data.status!=='ready'||!Number.isInteger(data.version)||Number(data.version)<1||typeof data.title!=='string'||!data.title.trim()||typeof data.textContent!=='string'||typeof data.categoryId!=='string'||typeof data.ownerId!=='string'||typeof data.ownerName!=='string'||!(data.createdAt instanceof Timestamp)||!(data.updatedAt instanceof Timestamp))throw new SparkMaterialError('incomplete');return {...data,id} as SparkPack;
}
export async function readSparkPack(db:Firestore,id:string):Promise<{pack:SparkPack;files:SparkFileMeta[];category:string}>{
 const root=doc(db,'packs',id),snapshot=await getDocFromServer(root);if(!snapshot.exists())throw new SparkMaterialError('notFound');const pack=packData(snapshot.data(),id);
 const groups=await Promise.all([0,1].map(index=>getDocFromServer(doc(db,'packs',id,'groups',String(index)))));const files:SparkFileMeta[]=[];
 for(const [index,group] of groups.entries()){
  const data=group.data();if(!data||data.version!==pack.version||!Array.isArray(data.slots)||data.slots.length>6||new Set(data.slots).size!==data.slots.length||!data.files||Object.keys(data.files).sort().join(',')!==[...data.slots].sort().join(','))throw new SparkMaterialError('incomplete');
  const selected:SparkFileMeta[]=[];for(const slot of data.slots){if(!Array.from({length:6},(_,offset)=>String(index*6+offset)).includes(slot)||!validMeta(data.files[slot]))throw new SparkMaterialError('incomplete');selected.push({slot,...data.files[slot]});}
  const expected=groupsFor(selected,pack.version)[index];for(const key of ['totalBytes','textCount','imageCount','eegCount'] as const)if(data[key]!==expected[key])throw new SparkMaterialError('incomplete');files.push(...selected);
 }
 const total=files.reduce((n,file)=>n+file.size,0),textCount=files.filter(f=>f.kind==='text').length,imageCount=files.filter(f=>f.kind==='image').length,eegCount=files.filter(f=>f.kind==='eeg').length;
 if(files.length>SPARK_LIMITS.count||total>SPARK_LIMITS.totalBytes||total!==pack.totalBytes||textCount!==pack.textFileCount||imageCount!==pack.imageCount||eegCount!==pack.eegCount||eegCount<1||!pack.textContent.trim()&&!textCount)throw new SparkMaterialError('incomplete');
 const [category,latest]=await Promise.all([getDocFromServer(doc(db,'categories',pack.categoryId)),getDocFromServer(root)]);if(!latest.exists()||latest.get('version')!==pack.version||latest.get('status')!=='ready')throw new SparkMaterialError('versionChanged');
 return {pack,files:files.sort((a,b)=>Number(a.slot)-Number(b.slot)),category:category.exists()?String(category.get('name')):''};
}
export async function readSparkFile(db:Firestore,packId:string,version:number,file:SparkFileMeta):Promise<Uint8Array>{
 const [root,snapshot]=await Promise.all([getDocFromServer(doc(db,'packs',packId)),getDocFromServer(doc(db,'packs',packId,'files',file.slot))]);
 if(!root.exists()||root.get('status')!=='ready'||root.get('version')!==version)throw new SparkMaterialError('versionChanged');
 if(!snapshot.exists())throw new SparkMaterialError('integrity');const data=snapshot.data();if(data.version!==version||data.slot!==file.slot||!(data.bytes instanceof Bytes)||!validMeta(meta(data as SparkFileMeta))||JSON.stringify(meta(data as SparkFileMeta))!==JSON.stringify(meta(file)))throw new SparkMaterialError('integrity');
 const bytes=(data.bytes as Bytes).toUint8Array();if(bytes.length!==file.size||await sparkDigest(bytes)!==file.sha256)throw new SparkMaterialError('integrity');
 return bytes;
}
export async function listSparkPacks(db:Firestore):Promise<SparkPack[]>{const saved=await getDocsFromServer(query(collection(db,'packs'),where('status','==','ready'),orderBy('createdAt','desc')));return saved.docs.map(snapshot=>packData(snapshot.data(),snapshot.id));}

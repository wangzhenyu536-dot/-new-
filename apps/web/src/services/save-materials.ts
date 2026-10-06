import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { getMetadata, ref, uploadBytesResumable, type UploadTask } from 'firebase/storage';
import type { BeginUploadInput, UploadSession, SaveResult, FileKind } from '@evertrace/shared';
import { functions, storage } from '../app/legacy-firebase';
export type SaveAttempt = { fingerprint: string; requestId: string };
export async function saveMaterials(input:{title:string;categoryId:string;textContent:string;attachments:{file:File;kind:FileKind}[];packId?:string;expectedVersion?:number;retainedFileIds?:string[]},attempt:{current:SaveAttempt|null},progress:(state:{phase:string;file?:string;percent?:number})=>void,signal:AbortSignal) {
  progress({phase:'preparing'});const selected=input.attachments;
  const filePlan:BeginUploadInput['filePlan']=[];
  for(const {file,kind} of selected){const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());signal.throwIfAborted();filePlan.push({kind,name:file.name,size:file.size,sha256:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')});}
  const manifest={title:input.title.trim(),categoryId:input.categoryId,textContent:input.textContent,filePlan,...(input.packId?{packId:input.packId,expectedVersion:input.expectedVersion,retainedFileIds:input.retainedFileIds}: {})},fingerprint=JSON.stringify(manifest);
  if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,requestId:crypto.randomUUID()};
  const session=(await httpsCallable<BeginUploadInput,UploadSession>(functions,'beginUpload')({...manifest,requestId:attempt.current.requestId})).data;
  signal.throwIfAborted();
  if(session.status!=='committed'&&session.status!=='validating')for(let i=0;i<session.files.length;i++){
    const file=session.files[i],target=ref(storage,file.stagingPath);progress({phase:'uploading',file:file.name,percent:0});signal.throwIfAborted();
    try{const existing=await getMetadata(target);if(existing.size!==file.size||existing.contentType!==file.mediaType)throw new Error('fileChanged');progress({phase:'uploading',file:file.name,percent:100});continue;}
    catch(error){if(!(error instanceof FirebaseError&&error.code==='storage/object-not-found'))throw error;}
    let task:UploadTask|undefined;
    const cancel=()=>task?.cancel();signal.addEventListener('abort',cancel,{once:true});
    try{await new Promise<void>((resolve,reject)=>{task=uploadBytesResumable(target,selected[i].file,{contentType:file.mediaType});task.on('state_changed',snapshot=>progress({phase:'uploading',file:file.name,percent:Math.round(snapshot.bytesTransferred/snapshot.totalBytes*100)}),reject,()=>resolve());if(signal.aborted)task.cancel();});}
    catch(error){throw Object.assign(new Error('uploadFailed'),{cause:error});}
    finally{signal.removeEventListener('abort',cancel);}
  }
  signal.throwIfAborted();progress({phase:'validating'});
  return (await httpsCallable<{sessionId:string},SaveResult>(functions,'savePack',{timeout:125000})({sessionId:session.sessionId})).data;
}

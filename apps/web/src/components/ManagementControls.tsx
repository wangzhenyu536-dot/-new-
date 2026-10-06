import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FirebaseError } from 'firebase/app';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../app/useAuth';
import { db, functions } from '../app/legacy-firebase';
export type ManagementResult={operationId:string;status:'done'|'pending';moved?:number};
export function managementError(error:unknown){const e=error as FirebaseError&{details?:{code?:string}};const code=e.details?.code;if(['versionConflict','saveBusy','operationBusy','categoryUnavailable','targetRequired','deletePending','categoryCountMismatch'].includes(code??''))return 'management.'+code;if(e.code==='functions/already-exists')return 'management.nameExists';if(e.code==='functions/permission-denied')return 'management.permissionDenied';if(e.code==='functions/invalid-argument')return 'management.invalid';return 'management.failed';}
export function ConfirmationDialog({title,busy,onClose,children}:{title:string;busy:boolean;onClose:()=>void;children:ReactNode}){
  const dialog=useRef<HTMLDialogElement>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{const element=dialog.current!,previous=document.activeElement as HTMLElement|null;element.showModal();return()=>{element.close();previous?.focus();};},[]);
  return <dialog className="management-dialog" ref={dialog} aria-label={title} onCancel={event=>{event.preventDefault();if(!busy)close.current();}}><h2>{title}</h2>{children}</dialog>;
}
export function DeletePackButton({packId,title,version,onResult}:{packId:string;title:string;version:number;onResult:(result:ManagementResult)=>void}){
  const {t}=useTranslation(),[open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const operation=useRef(''),inFlight=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function remove(){if(inFlight.current||!confirmed)return;inFlight.current=true;setBusy(true);setError('');try{const result=await httpsCallable<Record<string,unknown>,ManagementResult>(functions,'deletePack')({packId,expectedVersion:version,operationId:operation.current,confirmation:packId});if(alive.current){setOpen(false);onResult(result.data);}}catch(e){if(alive.current)setError(managementError(e));}finally{inFlight.current=false;if(alive.current)setBusy(false);}}
  return <><button className="button button-danger" onClick={()=>{setConfirmed(false);setError('');operation.current=crypto.randomUUID();setOpen(true);}}>{t('management.deletePack')}</button>{open&&<ConfirmationDialog title={t('management.confirmDeletePack')} busy={busy} onClose={()=>setOpen(false)}><p className="management-warning">{t('management.packWarning')}</p><p className="management-target">{title}</p><fieldset disabled={busy}><label className="management-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>{t('management.understand')}</label>{error&&<p role="alert">{t(error)}</p>}{busy&&<p role="status">{t('management.deleting')}</p>}<div className="account-actions"><button className="button" onClick={()=>setOpen(false)}>{t('management.cancel')}</button><button className="button button-danger" disabled={!confirmed} onClick={()=>void remove()}>{t('management.deletePermanently')}</button></div></fieldset></ConfirmationDialog>}</>;
}
type Job={id:string;kind:string;packId?:string;sourceId?:string;moved?:number};
export function PendingOperations({packId}:{packId?:string}){
  const access=useAuth(),uid=access.user?.uid,role=access.profile?.role;
  const {t}=useTranslation(),[jobs,setJobs]=useState<Job[]>([]),[loadError,setLoadError]=useState(false),[retry,setRetry]=useState(0),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');const inFlight=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{setJobs([]);setLoadError(false);if(!uid||!role)return;const filters=[where('status','==','pending'),...(role==='admin'?[]:[where('ownerId','==',uid),where('kind','==','deletePack')])];return onSnapshot(query(collection(db,'adminOperations'),...filters),saved=>setJobs(saved.docs.map(d=>({id:d.id,...d.data()} as Job))),()=>setLoadError(true));},[retry,uid,role]);
  async function resume(id:string){if(inFlight.current)return;inFlight.current=true;setBusy(id);setError('');setNotice('');try{const result=await httpsCallable<{operationId:string},ManagementResult>(functions,'retryCleanup')({operationId:id});if(alive.current)setNotice(result.data.status==='done'?'management.completed':'management.pending');}catch(e){if(alive.current)setError(managementError(e));}finally{inFlight.current=false;if(alive.current)setBusy('');}}
  const shown=packId?jobs.filter(j=>j.packId===packId):jobs;
  return <>{loadError&&<div role="alert"><p>{t('management.jobsError')}</p><button className="button" onClick={()=>setRetry(n=>n+1)}>{t('account.retry')}</button></div>}{shown.length>0&&<section className="pending-operations"><h2>{t('management.pendingTitle')}</h2><p>{t('management.pendingHint')}</p>{shown.map(job=><div className="pending-operation" key={job.id}><p>{t(job.kind==='deletePack'?'management.packCleanup':'management.categoryMigration')}{job.kind==='deleteCategory'&&' · '+t('management.moved',{count:job.moved??0})}<small>{t('management.reference')}: {job.packId??job.sourceId}</small></p><button className="button" disabled={Boolean(busy)} onClick={()=>void resume(job.id)}>{t(busy===job.id?'account.working':'management.retryCleanup')}</button></div>)}</section>}{error&&<p role="alert">{t(error)}</p>}{notice&&<p role="status">{t(notice)}</p>}</>;
}
export function RetryFileCleanup({sessions,onDone}:{sessions:string[];onDone:()=>void}){
 const {t}=useTranslation(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function retry(){if(busy)return;setBusy(true);setError('');try{for(const operationId of sessions){const result=await httpsCallable<{operationId:string},ManagementResult>(functions,'retryCleanup')({operationId});if(result.data.status!=='done')throw new Error('pending');}onDone();}catch(e){setError(managementError(e));}finally{setBusy(false);}}
 return <div><button className="button" disabled={busy} onClick={()=>void retry()}>{t(busy?'account.working':'management.retryCleanup')}</button>{error&&<p role="alert">{t(error)}</p>}</div>;
}

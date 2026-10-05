import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {StoredFile} from '@evertrace/shared';
import {assemblePackExport,assertExportVersion,verifiedOriginal,safeDownloadName,type ExportPack,type ExportProgress} from '../services/export-pack';
import {browserExportDependencies,deliverDownload} from '../services/export-browser';
type Action={kind:'zip'}|{kind:'original'|'png';file:StoredFile};
export function usePackDownloads(pack:ExportPack|null,files:StoredFile[]){
 const {t,i18n}=useTranslation(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[complete,setComplete]=useState(false),[progress,setProgress]=useState<ExportProgress|null>(null),controller=useRef<AbortController|null>(null),last=useRef<Action|null>(null),active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{controller.current?.abort();setError('');setComplete(false);},[pack]);
 async function start(action:Action){if(!pack||controller.current)return;const current=new AbortController();controller.current=current;last.current=action;setBusy(true);setComplete(false);setError('');setProgress(null);const dependencies=browserExportDependencies(pack),language=i18n.resolvedLanguage??'en';
 try{
  if(action.kind==='zip'){const result=await assemblePackExport(pack,files,language,dependencies,current.signal,value=>{if(active.current)setProgress(value);});current.signal.throwIfAborted();if(active.current)deliverDownload(result.bytes,result.name,'application/zip');}
  else{await assertExportVersion(pack,dependencies.readVersion,current.signal);setProgress({phase:'reading',name:action.file.originalName,done:0,total:1});const original=await verifiedOriginal(action.file,dependencies,current.signal);let bytes=original,name=safeDownloadName(action.file.originalName),type=action.file.mediaType;if(action.kind==='png'){setProgress({phase:'waveforms',name,done:0,total:1});const parsed=await dependencies.parseEeg(original,name,current.signal);bytes=await dependencies.renderPng(parsed,name,language,current.signal);name=name.replace(/\.xlsx$/i,'')+'.png';type='image/png';}await assertExportVersion(pack,dependencies.readVersion,current.signal);current.signal.throwIfAborted();if(active.current)deliverDownload(bytes,name,type);}
  if(active.current)setComplete(true);
 }catch(cause){if(active.current)setError(current.signal.aborted?'exportCancelled':cause instanceof Error&&['exportChanged','exportIntegrity','exportInvalid','exportBudget'].includes(cause.message)?cause.message:'exportFailed');}
 finally{if(controller.current===current)controller.current=null;if(active.current){setBusy(false);setProgress(null);}}
 }
 const controls=<div className="pack-downloads"><button className="button button-dark" disabled={busy||!pack} onClick={()=>void start({kind:'zip'})}>{t('download.zip')}</button>{busy&&<><p role="status">{progress?t('download.'+progress.phase,{name:progress.name??'',done:progress.done,total:progress.total}):t('download.preparing')}</p><button className="button" onClick={()=>controller.current?.abort()}>{t('download.cancel')}</button></>}{complete&&<p role="status">{t('download.complete')}</p>}{error&&<div role="alert"><p>{t('download.'+error)}</p>{error==='exportChanged'?<button className="button" onClick={()=>location.reload()}>{t('download.reload')}</button>:<button className="button" disabled={busy} onClick={()=>{if(last.current)void start(last.current);}}>{t('download.retry')}</button>}</div>}<p className="field-note">{t('download.fullRange')}</p></div>;
 function fileControls(file:StoredFile){return <div className="file-downloads"><button className="button" disabled={busy} onClick={()=>void start({kind:'original',file})}>{t('download.original')}</button>{file.kind==='eeg'&&<button className="button" disabled={busy} onClick={()=>void start({kind:'png',file})}>{t('download.png')}</button>}</div>;}
 return {controls,fileControls};
}

import { DeletePackButton, PendingOperations, RetryFileCleanup } from '../components/ManagementControls';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where, type Timestamp } from 'firebase/firestore';
import { getBytes, ref } from 'firebase/storage';
import { useTranslation } from 'react-i18next';
import { PREVIEW_LIMITS, validateText, type StoredFile, type EegResult, type Issue } from '@evertrace/shared';
import { useAuth } from '../app/useAuth';
import { db, storage } from '../app/legacy-firebase';
import { AccountLayout } from '../components/AccountLayout';
import { MemberBar } from '../components/MemberBar';
import { IssueList } from '../components/IssueList';
import { EegPreview } from '../components/EegPreview';
import {usePackDownloads} from '../components/PackDownloads';
type Pack={title:string;ownerName:string;ownerId:string;textContent:string;categoryId:string;createdAt:Timestamp;version:number;status:string;cleanupPending?:boolean;cleanupSessions?:Record<string,boolean>};
export function StoredMaterial({file,downloadControls}:{file:StoredFile;downloadControls?:ReactNode}){
  const {t}=useTranslation(),[status,setStatus]=useState('loading'),[text,setText]=useState(''),[result,setResult]=useState<EegResult|null>(null),[issues,setIssues]=useState<Issue[]>([]),[retry,setRetry]=useState(0),[imageUrl,setImageUrl]=useState('');
  const worker=useRef<Worker|null>(null);
  useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>|undefined;let objectUrl:string|undefined;setImageUrl('');setText('');setResult(null);setIssues([]);setStatus('loading');
    void getBytes(ref(storage,file.storagePath),file.size).then(async buffer=>{
      const hash=await crypto.subtle.digest('SHA-256',buffer);if(!active)return;
      if(buffer.byteLength!==file.size||[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')!==file.sha256)throw new Error('integrity');
      if(file.kind==='image'){objectUrl=URL.createObjectURL(new Blob([buffer],{type:file.mediaType}));setImageUrl(objectUrl);setStatus('ready');return;}
      if(file.kind==='text'){const checked=validateText(new Uint8Array(buffer),file.originalName);setIssues(checked.issues);if(!checked.ok){setStatus('invalid');return;}setText(checked.text!);setStatus('ready');return;}
      const current=new Worker(new URL('../workers/eeg.worker.ts',import.meta.url),{type:'module'});worker.current=current;
      timer=setTimeout(()=>{if(active){setStatus('error');current.terminate();}},PREVIEW_LIMITS.parseMs);
      current.onmessage=(event:MessageEvent<EegResult>)=>{if(!active)return;clearTimeout(timer);current.terminate();setResult(event.data);setIssues(event.data.issues);setStatus(event.data.ok?'ready':'invalid');};current.onerror=()=>{if(active){clearTimeout(timer);setStatus('error');current.terminate();}};
      const bytes=new Uint8Array(buffer);current.postMessage({bytes,name:file.originalName},[bytes.buffer]);
    }).catch(()=>{if(active)setStatus('error');});
    return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);clearTimeout(timer);worker.current?.terminate();worker.current=null;};
  },[file,retry]);
  return <section className="pack-section stored-material"><h2>{file.originalName}</h2>{downloadControls}<p className="field-note">{t(file.kind==='eeg'?'packs.originalEeg':file.kind==='image'?'packs.originalImage':'packs.originalText')} · {file.size.toLocaleString()} B</p>{status==='loading'&&<p role="status">{t('packs.fileLoading')}</p>}{status==='error'&&<div role="alert"><p>{t('packs.fileError')}</p><button className="button" onClick={()=>setRetry(n=>n+1)}>{t('packs.retryFile')}</button></div>}<IssueList issues={issues}/>{status==='ready'&&(file.kind==='image'?<img className="pack-image" src={imageUrl} alt={file.originalName}/>:file.kind==='text'?<pre className="pack-text">{text}</pre>:result&&<EegPreview result={result}/>)}</section>;
}
export function PackDetailPage(){
  const access=useAuth();
  const {id}=useParams(),{t,i18n}=useTranslation(),[pack,setPack]=useState<Pack|null>(null),[files,setFiles]=useState<StoredFile[]>([]),[category,setCategory]=useState(''),[status,setStatus]=useState('loading'),[retry,setRetry]=useState(0);
  const exportPack=useMemo(()=>pack&&id?{...pack,id,category,createdAt:pack.createdAt.toDate().toISOString()}:null,[pack,id,category]);
  const downloads=usePackDownloads(exportPack,files);
  useEffect(()=>{let active=true;setPack(null);setFiles([]);setCategory('');setStatus('loading');
    if(!id||! /^[A-Za-z0-9_-]{1,100}$/.test(id)){setStatus('missing');return;}
    void getDoc(doc(db,'packs',id)).then(async saved=>{if(!active)return;if(!saved.exists()){setStatus('missing');return;}if(saved.get('status')!=='ready'){setStatus('deleting');return;}const data=saved.data() as Pack;const [attachments,cat]=await Promise.all([getDocs(query(collection(db,'packs',id,'files'),where('active','==',true))),getDoc(doc(db,'categories',data.categoryId))]);if(!active)return;const latest=await getDoc(doc(db,'packs',id));if(latest.get('version')!==data.version)throw new Error('versionChanged');const materials=attachments.docs.map(d=>({id:d.id,...d.data()} as StoredFile));if(!materials.some(f=>f.kind==='eeg')||!data.textContent.trim()&&!materials.some(f=>f.kind==='text'))throw new Error('incomplete');setPack(data);setFiles(materials);setCategory(cat.get('name')??'');setStatus('ready');}).catch(()=>{if(active)setStatus('error');});
    return()=>{active=false;};
  },[id,retry]);
  return <AccountLayout><MemberBar/>{status==='loading'&&<p role="status">{t('packs.loading')}</p>}{status==='deleted'&&<h1>{t('management.packDeleted')}</h1>}{status==='deleting'&&<><h1>{t('management.packCleanup')}</h1><p>{t('management.pendingHint')}</p>{<PendingOperations packId={id}/>}</>}{status==='missing'&&<><h1>{t('packs.notFound')}</h1><p>{t('packs.notFoundHint')}</p></>}{status==='error'&&<div role="alert"><h1>{t('packs.detailError')}</h1><button className="button" onClick={()=>setRetry(n=>n+1)}>{t('account.retry')}</button></div>}{status==='ready'&&pack&&<><h1 className="pack-detail-title">{pack.title}</h1><dl className="pack-detail-meta"><div><dt>{t('form.category')}</dt><dd>{category||t('packs.categoryUnavailable')}</dd></div><div><dt>{t('packs.creator')}</dt><dd>{pack.ownerName}</dd></div><div><dt>{t('packs.created')}</dt><dd>{pack.createdAt?.toDate().toLocaleString(i18n.resolvedLanguage)}</dd></div></dl>{pack.cleanupPending&&<p role="status">{t('packs.cleanupPending')}</p>}{pack.cleanupPending&&access.profile?.role==='admin'&&<RetryFileCleanup sessions={Object.keys(pack.cleanupSessions??{})} onDone={()=>setRetry(n=>n+1)}/>} {(pack.ownerId===access.user?.uid||access.profile?.role==='admin')&&id&&<DeletePackButton packId={id} title={pack.title} version={pack.version} onResult={result=>{setStatus(result.status==='done'?'deleted':'deleting');setFiles([]);setPack(null);}}/>}{(pack.ownerId===access.user?.uid||access.profile?.role==='admin')&&<Link className="button" to={'/packs/'+id+'/edit'}>{t('packs.edit')}</Link>}{downloads.controls}<p className="pack-shared">{t('packs.shared')}</p>{pack.textContent.trim()&&<section className="pack-section"><h2>{t('form.notes')}</h2><pre className="pack-text">{pack.textContent}</pre></section>}{files.map(file=><StoredMaterial key={file.id} file={file} downloadControls={downloads.fileControls(file)}/>)}</>}<Link className="pack-back" to="/packs">{t('browseTitle')} <span aria-hidden="true">↗</span></Link></AccountLayout>;
}

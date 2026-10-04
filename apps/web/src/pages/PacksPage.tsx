import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, limit, orderBy, query, where, startAfter, type QueryDocumentSnapshot, type DocumentData, type Timestamp } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../app/AuthProvider';
import { db } from '../app/firebase';
import { AccountLayout } from '../components/AccountLayout';
import { MemberBar } from '../components/MemberBar';
type Pack={id:string;title:string;ownerName:string;categoryId:string;createdAt:Timestamp};
export function PacksPage(){
  const {t,i18n}=useTranslation(),access=useAuth();const [packs,setPacks]=useState<Pack[]>([]),[categories,setCategories]=useState<Record<string,string>>({}),[status,setStatus]=useState('loading'),[retry,setRetry]=useState(0),[cursor,setCursor]=useState<QueryDocumentSnapshot<DocumentData>|null>(null),[more,setMore]=useState(false),[last,setLast]=useState<QueryDocumentSnapshot<DocumentData>|null>(null);
  useEffect(()=>{let active=true;void Promise.all([getDocs(query(collection(db,'packs'),where('status','==','ready'),orderBy('createdAt','desc'),orderBy('__name__','desc'),...(cursor?[startAfter(cursor)]:[]),limit(20))),getDocs(collection(db,'categories'))]).then(([page,cats])=>{if(!active)return;setPacks(previous=>cursor?[...previous,...page.docs.map(doc=>({id:doc.id,...doc.data()} as Pack))]:page.docs.map(doc=>({id:doc.id,...doc.data()} as Pack)));setCategories(Object.fromEntries(cats.docs.map(d=>[d.id,d.get('name')])));setLast(page.docs.at(-1)??null);setMore(page.size===20);setStatus('ready');}).catch(()=>{if(active)setStatus('error');});return()=>{active=false;};},[cursor,retry]);
  return <AccountLayout><MemberBar/><div className="pack-list-heading"><h1>{t('browseTitle')}</h1><Link className="button button-dark" to="/packs/new">{t('createTitle')} <span aria-hidden="true">↗</span></Link>{access.profile?.role==='admin'&&<Link className="button" to="/admin/members">{t('account.membersTitle')}</Link>}</div><p>{t('packs.shared')}</p>{status==='loading'&&<p role="status">{t('packs.loading')}</p>}{status==='error'&&<div role="alert"><p>{t('packs.loadError')}</p><button className="button" onClick={()=>{setStatus('loading');setRetry(n=>n+1);}}>{t('account.retry')}</button></div>}{status==='ready'&&!packs.length&&<p className="pack-empty">{t('packs.empty')}</p>}
    <ul className="pack-list">{packs.map(pack=><li key={pack.id}><Link to={'/packs/'+pack.id}>{pack.title} <span aria-hidden="true">↗</span></Link><div><span>{categories[pack.categoryId]??t('packs.categoryUnavailable')}</span><span>{pack.ownerName}</span><time>{pack.createdAt?.toDate().toLocaleString(i18n.resolvedLanguage)}</time></div></li>)}</ul>{more&&status==='ready'&&<button className="button" onClick={()=>{setStatus('loading');setCursor(last);}}>{t('packs.more')}</button>}
  </AccountLayout>;
}

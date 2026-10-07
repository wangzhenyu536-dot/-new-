import { useEffect, useRef, useState, type FormEvent } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../app/useAuth';
import { db } from '../app/firebase';
import { createSparkCategory } from '../services/spark-account';
import { AccountLayout } from '../components/AccountLayout';
import { MemberBar } from '../components/MemberBar';
type Category = {id:string;name:string;status:string};
export function SparkCategoriesPage() {
  const {t} = useTranslation(), {profile} = useAuth();
  const [categories,setCategories] = useState<Category[]>([]), [loading,setLoading] = useState(true), [loadError,setLoadError] = useState(false), [attempt,setAttempt] = useState(0);
  const [name,setName] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const inFlight = useRef(false), alive = useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    setLoading(true);setLoadError(false);
    return onSnapshot(collection(db,'categories'), snapshot=>{
      setCategories(snapshot.docs.map(value=>({id:value.id,...value.data()} as Category)).filter(value=>value.status==='active').sort((a,b)=>a.name.localeCompare(b.name)));
      setLoading(false);
    },()=>{setLoading(false);setLoadError(true);});
  },[attempt]);
  async function submit(event:FormEvent) {
    event.preventDefault();if(inFlight.current||!profile)return;
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try {
      const result = await createSparkCategory(db,profile.uid,name);
      if(alive.current){setName('');setNotice(result.created?'spark.categoryAdded':'spark.categoryExists');}
    } catch(failure) {if(alive.current)setError(failure instanceof Error&&failure.message==='categoryInvalid'?'validation.categoryInvalid':'form.categoryError');}
    finally{inFlight.current=false;if(alive.current)setBusy(false);}
  }
  return <AccountLayout><MemberBar/><h1>{t('spark.categoriesTitle')}</h1><p>{t('spark.categoriesHint')}</p>{profile?.role === 'admin' && <nav className="account-actions" aria-label={t('account.workspaceNav')}><Link className="button" to="/admin/categories">{t('management.categoriesTitle')}</Link><Link className="button" to="/admin/members">{t('account.membersTitle')}</Link></nav>}<form className="category-create" onSubmit={event=>void submit(event)}><label htmlFor="spark-category-name">{t('form.newCategory')}</label><div><input id="spark-category-name" value={name} maxLength={120} disabled={busy} onChange={event=>setName(event.target.value)}/><button className="button button-dark" disabled={busy||!name.trim()}>{t(busy?'account.working':'form.addCategory')}</button></div>{error&&<p role="alert">{t(error)}</p>}{notice&&<p role="status">{t(notice)}</p>}</form>{loading&&<p role="status">{t('form.categoriesLoading')}</p>}{loadError&&<div role="alert"><p>{t('form.categoriesError')}</p><button className="button" onClick={()=>setAttempt(value=>value+1)}>{t('account.retry')}</button></div>}{!loading&&!loadError&&categories.length===0&&<p>{t('form.noCategories')}</p>}<div className="category-list">{!loadError&&categories.map(category=><article key={category.id}><h2>{category.name}</h2></article>)}</div><Link className="pack-back" to="/packs">{t('spark.workspaceTitle')} ↗</Link></AccountLayout>;
}

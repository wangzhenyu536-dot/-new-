import { PendingOperations } from '../components/ManagementControls';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {collection,getDocsFromServer} from 'firebase/firestore';
import {useTranslation} from 'react-i18next';
import {useAuth} from '../app/AuthProvider';
import {db} from '../app/firebase';
import {AccountLayout} from '../components/AccountLayout';
import {MemberBar} from '../components/MemberBar';
import {getPackPage,packQueryKey,type ListedPack,type PackCursor,type PackFilters} from '../services/query-packs';
type ListState={key:string;packs:ListedPack[];cursor:PackCursor|null;more:boolean;status:'loading'|'loadingMore'|'ready'|'error';appendFailed:boolean;invalid:boolean};
const initial:ListState={key:'',packs:[],cursor:null,more:false,status:'loading',appendFailed:false,invalid:false};
export function PacksPage(){
  const {t,i18n}=useTranslation(),access=useAuth(),[params,setParams]=useSearchParams();
  const prefix=params.get('q')??'',categoryId=params.get('category')??'',scope=params.get('scope')==='mine'?'mine':'all';
  const filters:PackFilters={prefix,categoryId,scope},uid=access.user?.uid??'',key=packQueryKey(filters,uid);
  const [draft,setDraft]=useState(prefix),[state,setState]=useState<ListState>(initial),[refresh,setRefresh]=useState(0);
  const [categories,setCategories]=useState<Record<string,string>>({}),[categoryStatus,setCategoryStatus]=useState('loading'),[categoryRetry,setCategoryRetry]=useState(0);
  const generation=useRef(0),inFlight=useRef(false);
  useEffect(()=>setDraft(prefix),[prefix]);
  useEffect(()=>{let active=true;setCategoryStatus('loading');void getDocsFromServer(collection(db,'categories')).then(saved=>{if(active){setCategories(Object.fromEntries(saved.docs.map(d=>[d.id,String(d.get('name'))])));setCategoryStatus('ready');}}).catch(()=>{if(active)setCategoryStatus('error');});return()=>{active=false;};},[categoryRetry]);
  useEffect(()=>{
    const token=++generation.current;inFlight.current=true;setState({...initial,key});
    void getPackPage(db,{prefix,categoryId,scope},uid).then(page=>{if(generation.current===token)setState({key,...page,status:'ready',appendFailed:false,invalid:false});}).catch(error=>{if(generation.current===token)setState({...initial,key,status:'error',invalid:error instanceof Error&&error.message==='queryInvalid'});}).finally(()=>{if(generation.current===token)inFlight.current=false;});
    return()=>{generation.current++;};
  },[key,refresh,prefix,categoryId,scope,uid]);
  const current=state.key===key?state:{...initial,key};
  function apply(next:PackFilters){const query=new URLSearchParams();if(next.prefix.trim())query.set('q',next.prefix.trim());if(next.categoryId)query.set('category',next.categoryId);if(next.scope==='mine')query.set('scope','mine');setParams(query);}
  function search(event:FormEvent){event.preventDefault();apply({...filters,prefix:draft});setRefresh(n=>n+1);}
  function clear(){setDraft('');apply({prefix:'',categoryId:'',scope:'all'});setRefresh(n=>n+1);}
  async function load(append:boolean){
    if(inFlight.current||state.key!==key||append&&!state.cursor)return;
    inFlight.current=true;const token=generation.current,cursor=append?state.cursor:null;
    setState(previous=>({...previous,status:append?'loadingMore':'loading',invalid:false}));
    try{const page=await getPackPage(db,filters,uid,cursor);if(generation.current!==token)return;
      setState(previous=>{const packs=append?[...previous.packs,...page.packs]:page.packs;const seen=new Set<string>();return {key,packs:packs.filter(pack=>{if(seen.has(pack.id))return false;seen.add(pack.id);return true;}),cursor:page.cursor,more:page.more,status:'ready',appendFailed:false,invalid:false};});
    }catch(error){if(generation.current===token)setState(previous=>({...previous,status:'error',appendFailed:append,invalid:error instanceof Error&&error.message==='queryInvalid'}));}
    finally{if(generation.current===token)inFlight.current=false;}
  }
  const activeFilters=Boolean(prefix.trim()||categoryId||scope==='mine');
  return <AccountLayout><MemberBar/><div className="pack-list-heading"><h1>{t('browseTitle')}</h1><Link className="button button-dark" to="/packs/new">{t('createTitle')} <span aria-hidden="true">↗</span></Link>{access.profile?.role==='admin'&&<Link className="button" to="/admin/categories">{t('management.categoriesTitle')}</Link>}{access.profile?.role==='admin'&&<Link className="button" to="/admin/members">{t('account.membersTitle')}</Link>}</div><p>{t('packs.shared')}</p><PendingOperations/>
    <form className="pack-filters" onSubmit={search}><div className="pack-search"><label htmlFor="pack-search">{t('packs.titlePrefix')}</label><div><input id="pack-search" type="search" value={draft} maxLength={160} onChange={event=>setDraft(event.target.value)}/><button className="button button-dark" type="submit">{t('packs.search')}</button></div><p className="field-note">{t('packs.prefixHint')}</p></div><div className="pack-filter-controls"><div><label htmlFor="filter-category">{t('packs.filterCategory')}</label><select id="filter-category" value={categoryId} disabled={categoryStatus!=='ready'} onChange={event=>apply({...filters,categoryId:event.target.value})}><option value="">{t(categoryStatus==='loading'?'form.categoriesLoading':'packs.allCategories')}</option>{categoryId&&!categories[categoryId]&&<option value={categoryId}>{t('packs.categoryUnavailable')}</option>}{Object.entries(categories).sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></div><div><label htmlFor="filter-scope">{t('packs.show')}</label><select id="filter-scope" value={scope} onChange={event=>apply({...filters,scope:event.target.value as PackFilters['scope']})}><option value="all">{t('packs.allPacks')}</option><option value="mine">{t('packs.myPacks')}</option></select></div><button className="button" type="button" onClick={clear}>{t('packs.clearFilters')}</button></div></form>
    {categoryStatus==='error'&&<div role="alert"><p>{t('packs.categoryLoadError')}</p><button className="button" onClick={()=>setCategoryRetry(n=>n+1)}>{t('form.retryCategories')}</button></div>}
    <p className="pack-sort-note">{t(prefix.trim()?'packs.titleOrder':'packs.newestFirst')}</p>
    {current.status==='loading'&&<p role="status">{t('packs.loading')}</p>}{current.status==='loadingMore'&&<p role="status">{t('packs.loadingMore')}</p>}
    {current.status==='error'&&<div role="alert"><p>{t(current.invalid?'packs.invalidFilters':'packs.loadError')}</p>{!current.invalid&&<button className="button" onClick={()=>void load(current.appendFailed)}>{t('account.retry')}</button>}</div>}
    {current.status==='ready'&&!current.packs.length&&<p className="pack-empty">{t(activeFilters?'packs.noMatches':'packs.empty')}</p>}
    <ul className="pack-list">{current.packs.map(pack=><li key={pack.id}><Link to={'/packs/'+pack.id}>{pack.title} <span aria-hidden="true">↗</span></Link><div><span>{categories[pack.categoryId]??t('packs.categoryUnavailable')}</span><span>{pack.ownerName}</span><time>{pack.createdAt?.toDate().toLocaleString(i18n.resolvedLanguage)}</time></div></li>)}</ul>
    {current.more&&(current.status==='ready'||current.status==='loadingMore')&&<button className="button" disabled={current.status==='loadingMore'} onClick={()=>void load(true)}>{t('packs.more')}</button>}
  </AccountLayout>;
}

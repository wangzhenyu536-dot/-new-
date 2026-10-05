import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { FirebaseError } from 'firebase/app';
import { useTranslation } from 'react-i18next';
import type { MemberRole, RoleChangeInput, RoleChangeResult } from '@evertrace/shared';
import { db, functions } from '../app/firebase';
import { useAuth } from '../app/AuthProvider';
import { AccountLayout } from '../components/AccountLayout';
import { MemberBar } from '../components/MemberBar';
import { ConfirmationDialog } from '../components/ManagementControls';
type Member={uid:string;email:string;displayName:string;role:MemberRole};
function roleError(error:unknown){const e=error as FirebaseError&{details?:{code?:string}};if(['lastAdminRequired','roleChanged','memberUnavailable','requestChanged'].includes(e.details?.code??''))return 'members.'+e.details!.code;if(e.code==='functions/permission-denied')return 'management.permissionDenied';if(e.code==='functions/not-found')return 'members.memberUnavailable';return 'members.failed';}
export function MembersPage(){
 const {t}=useTranslation(),access=useAuth(),[members,setMembers]=useState<Member[]>([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(false),[retry,setRetry]=useState(0),[selected,setSelected]=useState<Member|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const inFlight=useRef(false),operation=useRef(''),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setLoading(true);setLoadError(false);setMembers([]);return onSnapshot(collection(db,'users'),saved=>{setMembers(saved.docs.map(d=>({...d.data(),uid:d.id} as Member)).sort((a,b)=>(a.displayName||a.email||a.uid).localeCompare(b.displayName||b.email||b.uid)));setLoading(false);},()=>{setMembers([]);setLoadError(true);setLoading(false);});},[retry]);
 const adminCount=members.filter(member=>member.role==='admin').length;
 function open(member:Member){setSelected(member);setConfirmed(false);setError('');setNotice('');operation.current=crypto.randomUUID();}
 async function change(){if(!selected||!confirmed||inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await httpsCallable<RoleChangeInput,RoleChangeResult>(functions,'setMemberRole')({uid:selected.uid,role:selected.role==='admin'?'member':'admin',expectedRole:selected.role,operationId:operation.current});if(alive.current){setSelected(null);setNotice('members.changed');}}catch(e){if(alive.current)setError(roleError(e));}finally{inFlight.current=false;if(alive.current)setBusy(false);}}
 return <AccountLayout><MemberBar/><h1>{t('account.membersTitle')}</h1><p>{t('members.hint')}</p>{loading&&<p role="status">{t('members.loading')}</p>}{loadError&&<div role="alert"><p>{t('members.loadFailed')}</p><button className="button" onClick={()=>setRetry(n=>n+1)}>{t('account.retry')}</button></div>}{!loading&&!loadError&&<p>{t('members.total',{count:members.length})} · {t('members.administrators',{count:adminCount})}</p>}{notice&&<p role="status">{t(notice)}</p>}
 <div className="member-list">{members.map(member=><article key={member.uid}><div><h2>{member.displayName||member.email||t('members.unnamed')}{member.uid===access.user?.uid&&<small>{t('members.you')}</small>}</h2><p className="member-email">{member.email}</p><p className="member-role">{t('account.'+member.role)}</p>{member.role==='admin'&&adminCount===1&&<p>{t('members.lastAdministrator')}</p>}</div><button className={'button '+(member.role==='admin'?'button-danger':'')} disabled={busy||member.role==='admin'&&adminCount===1} onClick={()=>open(member)}>{t(member.role==='admin'?'members.demote':'members.promote')}</button></article>)}</div>
 {selected&&<ConfirmationDialog title={t('members.confirmTitle')} busy={busy} onClose={()=>setSelected(null)}><p className="management-target">{selected.displayName||selected.email}</p><p className="member-email">{selected.email}</p><p>{t(selected.role==='admin'?'members.demoteHint':'members.promoteHint')}</p>{selected.uid===access.user?.uid&&selected.role==='admin'&&<p>{t('members.selfDemoteHint')}</p>}<fieldset disabled={busy}><label className="management-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>{t('members.understand')}</label>{error&&<p role="alert">{t(error)}</p>}{busy&&<p role="status">{t('account.working')}</p>}<div className="account-actions"><button className="button" onClick={()=>setSelected(null)}>{t('management.cancel')}</button><button className="button button-dark" disabled={!confirmed} onClick={()=>void change()}>{t('members.confirm')}</button></div></fieldset></ConfirmationDialog>}
 <Link className="pack-back" to="/packs">{t('browseTitle')} ↗</Link></AccountLayout>;
}

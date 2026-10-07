import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../app/firebase';
import { useAuth } from '../app/useAuth';
import { createSparkCategory } from '../services/spark-account';
import { beginSparkCategoryDelete, renameSparkCategory, resumeSparkOperation } from '../services/spark-management';
import { AccountLayout } from '../components/AccountLayout';
import { MemberBar } from '../components/MemberBar';
import { SparkConfirmationDialog, SparkPendingOperations, sparkManagementError } from '../components/SparkManagementControls';

type Category = { id: string; name: string; status: string };
export function SparkAdminCategoriesPage() {
  const { t } = useTranslation(), uid = useAuth().user?.uid;
  const [categories, setCategories] = useState<Category[]>([]), [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(false), [statsStatus, setStatsStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [retry, setRetry] = useState(0);
  const [newName, setNewName] = useState(''), [adding, setAdding] = useState(false), [addError, setAddError] = useState(''), [addNotice, setAddNotice] = useState('');
  const [selected, setSelected] = useState<Category | null>(null), [action, setAction] = useState<'rename' | 'delete'>('rename'), [name, setName] = useState(''), [target, setTarget] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [workingOperation, setWorkingOperation] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [moved, setMoved] = useState(0);
  const inFlight = useRef(false), addBusy = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setLoading(true); setLoadError(false);
    return onSnapshot(collection(db, 'categories'), snapshot => { setCategories(snapshot.docs.map(saved => ({ id: saved.id, name: String(saved.get('name')), status: String(saved.get('status')) })).sort((a, b) => a.name.localeCompare(b.name))); setLoading(false); }, () => { setLoadError(true); setLoading(false); });
  }, [retry]);
  useEffect(() => {
    setStatsStatus('loading');
    return onSnapshot(collection(db, 'categoryStats'), snapshot => { setCounts(Object.fromEntries(snapshot.docs.filter(saved => Number.isSafeInteger(saved.get('packCount')) && saved.get('packCount') >= 0).map(saved => [saved.id, saved.get('packCount') as number]))); setStatsStatus('ready'); }, () => setStatsStatus('error'));
  }, [retry]);
  function open(category: Category, next: 'rename' | 'delete') { setSelected(category); setAction(next); setName(category.name); setTarget(''); setConfirmed(false); setError(''); setNotice(''); }
  async function add(event: FormEvent) {
    event.preventDefault(); if (addBusy.current || !uid) return;
    addBusy.current = true; setAdding(true); setAddError(''); setAddNotice('');
    try { const result = await createSparkCategory(db, uid, newName); if (alive.current) { setNewName(''); setAddNotice(result.created ? 'spark.categoryAdded' : 'spark.categoryExists'); } }
    catch (failure) { if (alive.current) setAddError(failure instanceof Error && failure.message === 'categoryInvalid' ? 'validation.categoryInvalid' : sparkManagementError(failure)); }
    finally { addBusy.current = false; if (alive.current) setAdding(false); }
  }
  async function submit() {
    if (!selected || !uid || inFlight.current || action === 'delete' && (!confirmed || counts[selected.id] === undefined || counts[selected.id] > 0 && !target)) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice(''); setMoved(0);
    try {
      if (action === 'rename') { await renameSparkCategory(db, uid, selected.id, name, selected.name); if (alive.current) { setSelected(null); setNotice('management.categoryRenamed'); } }
      else {
        const operation = await beginSparkCategoryDelete(db, uid, selected.id, target, selected.id);
        if (alive.current) { setSelected(null); setWorkingOperation(operation.id); }
        try { const result = await resumeSparkOperation(db, uid, operation.id, value => { if (alive.current) setMoved(value.moved); }); if (alive.current) setNotice(result.status === 'done' ? 'management.categoryDeleted' : 'management.pending'); }
        catch (failure) { if (alive.current) { setError(sparkManagementError(failure)); setNotice('management.pending'); } }
      }
    } catch (failure) { if (alive.current) setError(sparkManagementError(failure)); }
    finally { inFlight.current = false; if (alive.current) { setBusy(false); setWorkingOperation(''); } }
  }
  const canSubmit = selected && (action === 'rename' ? Boolean(name.trim()) : confirmed && counts[selected.id] !== undefined && (counts[selected.id] === 0 || Boolean(target)));
  return <AccountLayout><MemberBar /><h1>{t('management.categoriesTitle')}</h1><p>{t('management.categoriesHint')}</p>
    <nav className="account-actions" aria-label={t('account.workspaceNav')}><Link className="button" to="/admin/members">{t('account.membersTitle')}</Link><Link className="button" to="/categories">{t('spark.categoriesTitle')}</Link></nav>
    <SparkPendingOperations busyOperation={workingOperation} />
    <form className="category-create" onSubmit={event => void add(event)}><label htmlFor="admin-new-category">{t('form.newCategory')}</label><div><input id="admin-new-category" value={newName} maxLength={120} disabled={adding} onChange={event => setNewName(event.target.value)} /><button className="button" disabled={adding || !newName.trim()}>{t(adding ? 'account.working' : 'form.addCategory')}</button></div>{addError && <p role="alert">{t(addError)}</p>}{addNotice && <p role="status">{t(addNotice)}</p>}</form>
    {(loading || statsStatus === 'loading') && <p role="status">{t('form.categoriesLoading')}</p>}{(loadError || statsStatus === 'error') && <div role="alert"><p>{t('form.categoriesError')}</p><button className="button" onClick={() => setRetry(value => value + 1)}>{t('account.retry')}</button></div>}{!loading && !loadError && !categories.length && <p>{t('form.noCategories')}</p>}
    {notice && <p role="status">{t(notice)}</p>}{workingOperation && <p role="status">{t('management.moved', { count: moved })}</p>}{error && !selected && <p role="alert">{t(error)}</p>}
    <div className="category-list">{!loadError && categories.map(category => { const locked = category.status !== 'active', ready = statsStatus === 'ready' && counts[category.id] !== undefined; return <article key={category.id}><h2>{category.name}</h2>{ready && <p>{t('management.packCount', { count: counts[category.id] })}</p>}{locked && <p>{t('management.categoryLocked')}</p>}{statsStatus === 'ready' && !ready && <p>{t('management.baselineRequired')}</p>}<div className="account-actions"><button className="button" disabled={locked || !ready || busy} onClick={() => open(category, 'rename')}>{t('management.rename')}</button><button className="button button-danger" disabled={locked || !ready || busy} onClick={() => open(category, 'delete')}>{t('management.deleteCategory')}</button></div></article>; })}</div>
    {selected && <SparkConfirmationDialog title={t(action === 'rename' ? 'management.renameCategory' : 'management.deleteCategory')} busy={busy} onClose={() => setSelected(null)}><p className="management-target">{selected.name}</p><fieldset disabled={busy}>{action === 'rename' ? <><label htmlFor="category-name">{t('management.categoryName')}</label><input id="category-name" value={name} maxLength={120} onChange={event => setName(event.target.value)} /></> : <><p className="management-warning">{t('management.categoryWarning')}</p>{counts[selected.id] > 0 && <p>{t('management.moveHint', { count: counts[selected.id] })}</p>}<label htmlFor="migration-target">{t('management.moveTo')}</label><select id="migration-target" value={target} onChange={event => setTarget(event.target.value)}><option value="">{t(counts[selected.id] > 0 ? 'management.chooseTarget' : 'management.noTargetNeeded')}</option>{categories.filter(category => category.id !== selected.id && category.status === 'active' && counts[category.id] !== undefined).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select><label className="management-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t('management.categoryUnderstand')}</label></>}{error && <p role="alert">{t(error)}</p>}{busy && <p role="status">{t('account.working')}</p>}<div className="account-actions"><button className="button" onClick={() => setSelected(null)}>{t('management.cancel')}</button><button className={'button ' + (action === 'delete' ? 'button-danger' : 'button-dark')} disabled={!canSubmit} onClick={() => void submit()}>{t(action === 'rename' ? 'management.saveName' : 'management.deleteCategory')}</button></div></fieldset></SparkConfirmationDialog>}
    <Link className="pack-back" to="/packs">{t('browseTitle')} ↗</Link>
  </AccountLayout>;
}

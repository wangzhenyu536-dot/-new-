import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { normalizeTitleSearch } from '@evertrace/shared';
import { AccountLayout } from '../components/AccountLayout';
import { MemberBar } from '../components/MemberBar';
import { SparkPendingOperations } from '../components/SparkManagementControls';
import { useAuth } from '../app/useAuth';
import { db } from '../app/firebase';
import { listSparkPackPage, type SparkListCursor, type SparkListFilters, type SparkPack } from '../services/spark-materials';

type ListState = { key: string; items: SparkPack[]; nextCursor: SparkListCursor | null; starts: (SparkListCursor | null)[]; index: number; status: 'loading' | 'loadingMore' | 'ready' | 'error'; invalid: boolean };
type Target = { index: number; cursor: SparkListCursor | null; starts: (SparkListCursor | null)[] };
const initial: ListState = { key: '', items: [], nextCursor: null, starts: [null], index: 0, status: 'loading', invalid: false };
export function SparkWorkspacePage({ upcoming = false }: { upcoming?: boolean }) {
  const { t, i18n } = useTranslation(), access = useAuth(), [params, setParams] = useSearchParams();
  const prefix = params.get('q') ?? '', categoryId = params.get('category') ?? '', scope = params.get('scope') === 'mine' ? 'mine' : 'all', uid = access.user?.uid ?? '';
  const key = JSON.stringify([normalizeTitleSearch(prefix.trim()), categoryId, scope, uid]), filters: SparkListFilters = { prefix, categoryId, scope };
  const [draft, setDraft] = useState(prefix), [state, setState] = useState<ListState>(initial), [refresh, setRefresh] = useState(0);
  const [categories, setCategories] = useState<Record<string, string>>({}), [categoryStatus, setCategoryStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [categoryRetry, setCategoryRetry] = useState(0);
  const generation = useRef(0), inFlight = useRef(false), retryTarget = useRef<Target | null>(null);
  useEffect(() => setDraft(prefix), [prefix]);
  useEffect(() => {
    if (upcoming) return;
    let active = true; setCategoryStatus('loading');
    void getDocsFromServer(collection(db, 'categories')).then(snapshot => { if (active) { setCategories(Object.fromEntries(snapshot.docs.map(saved => [saved.id, String(saved.get('name'))]))); setCategoryStatus('ready'); } }).catch(() => { if (active) setCategoryStatus('error'); });
    return () => { active = false; };
  }, [upcoming, categoryRetry]);
  useEffect(() => {
    if (upcoming) return;
    const token = ++generation.current; inFlight.current = true; retryTarget.current = null; setState({ ...initial, key });
    void listSparkPackPage(db, uid, { prefix, categoryId, scope }).then(page => { if (generation.current === token) setState({ key, ...page, starts: [null], index: 0, status: 'ready', invalid: false }); }).catch(error => {
      if (generation.current === token) { retryTarget.current = { index: 0, cursor: null, starts: [null] }; setState({ ...initial, key, status: 'error', invalid: error instanceof Error && error.message === 'queryInvalid' }); }
    }).finally(() => { if (generation.current === token) inFlight.current = false; });
    return () => { generation.current++; };
  }, [upcoming, key, refresh, prefix, categoryId, scope, uid]);
  const current = state.key === key ? state : { ...initial, key };
  function apply(next: SparkListFilters) {
    const query = new URLSearchParams(); if (next.prefix?.trim()) query.set('q', next.prefix.trim()); if (next.categoryId) query.set('category', next.categoryId); if (next.scope === 'mine') query.set('scope', 'mine'); setParams(query);
  }
  function search(event: FormEvent) { event.preventDefault(); apply({ ...filters, prefix: draft }); setRefresh(value => value + 1); }
  function clear() { setDraft(''); apply({ prefix: '', categoryId: '', scope: 'all' }); setRefresh(value => value + 1); }
  async function load(target: Target) {
    if (inFlight.current || state.key !== key) return;
    inFlight.current = true; retryTarget.current = target; const token = generation.current;
    setState(previous => ({ ...previous, status: 'loadingMore', invalid: false }));
    try {
      const page = await listSparkPackPage(db, uid, filters, target.cursor);
      if (generation.current === token) { setState({ key, ...page, starts: target.starts, index: target.index, status: 'ready', invalid: false }); retryTarget.current = null; }
    } catch (error) { if (generation.current === token) setState(previous => ({ ...previous, status: 'error', invalid: error instanceof Error && error.message === 'queryInvalid' })); }
    finally { if (generation.current === token) inFlight.current = false; }
  }
  function nextPage() { if (current.nextCursor) void load({ index: current.index + 1, cursor: current.nextCursor, starts: [...current.starts.slice(0, current.index + 1), current.nextCursor] }); }
  function previousPage() { if (current.index > 0) void load({ index: current.index - 1, cursor: current.starts[current.index - 1], starts: current.starts }); }
  const activeFilters = Boolean(prefix.trim() || categoryId || scope === 'mine');
  return <AccountLayout><MemberBar />
    <h1>{t(upcoming ? 'spark.upcomingTitle' : 'spark.workspaceTitle')}</h1>
    <p>{t(upcoming ? 'spark.upcomingHint' : 'spark.workspaceHint')}</p>
    {upcoming && <section className="preview-status"><strong>{access.profile?.displayName}</strong><p>{t('spark.available')}</p><small>{t('spark.next')}</small></section>}
    <nav className="account-actions" aria-label={t('account.workspaceNav')}>
      <Link className="button" to="/categories">{t('spark.categoriesTitle')} <span aria-hidden="true">↗</span></Link>
      <Link className="button button-dark" to={upcoming ? '/packs' : '/packs/new'}>{t(upcoming ? 'spark.workspaceTitle' : 'createTitle')} <span aria-hidden="true">↗</span></Link>
      {access.profile?.role === 'admin' && <><Link className="button" to="/admin/categories">{t('management.categoriesTitle')}</Link><Link className="button" to="/admin/members">{t('account.membersTitle')}</Link></>}
    </nav>
    {!upcoming && <>
      <SparkPendingOperations onDone={() => setRefresh(value => value + 1)} />
      <p className="pack-shared">{t('packs.shared')}</p>
      <form className="pack-filters" onSubmit={search}><div className="pack-search"><label htmlFor="pack-search">{t('packs.titlePrefix')}</label><div><input id="pack-search" type="search" value={draft} maxLength={160} onChange={event => setDraft(event.target.value)} /><button className="button button-dark" type="submit">{t('packs.search')}</button></div><p className="field-note">{t('packs.prefixHint')}</p></div><div className="pack-filter-controls"><div><label htmlFor="filter-category">{t('packs.filterCategory')}</label><select id="filter-category" value={categoryId} disabled={categoryStatus !== 'ready'} onChange={event => apply({ ...filters, categoryId: event.target.value })}><option value="">{t(categoryStatus === 'loading' ? 'form.categoriesLoading' : 'packs.allCategories')}</option>{categoryId && !categories[categoryId] && <option value={categoryId}>{t('packs.categoryUnavailable')}</option>}{Object.entries(categories).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></div><div><label htmlFor="filter-scope">{t('packs.show')}</label><select id="filter-scope" value={scope} onChange={event => apply({ ...filters, scope: event.target.value as SparkListFilters['scope'] })}><option value="all">{t('packs.allPacks')}</option><option value="mine">{t('packs.myPacks')}</option></select></div><button className="button" type="button" onClick={clear}>{t('packs.clearFilters')}</button></div></form>
      {categoryStatus === 'error' && <div role="alert"><p>{t('packs.categoryLoadError')}</p><button className="button" onClick={() => setCategoryRetry(value => value + 1)}>{t('form.retryCategories')}</button></div>}
      <p className="pack-sort-note">{t(prefix.trim() ? 'packs.titleOrder' : 'packs.newestFirst')}</p>
      {current.status === 'loading' && <p role="status">{t('packs.loading')}</p>}
      {current.status === 'loadingMore' && <p role="status">{t('packs.loadingMore')}</p>}
      {current.status === 'error' && <div role="alert"><p>{t(current.invalid ? 'packs.invalidFilters' : 'packs.loadError')}</p>{!current.invalid && <button className="button" onClick={() => { if (retryTarget.current) void load(retryTarget.current); }}>{t('account.retry')}</button>}</div>}
      {current.status === 'ready' && !current.items.length && <p className="pack-empty">{t(activeFilters ? 'packs.noMatches' : 'packs.empty')}</p>}
      <ul className="pack-list">{current.items.map(pack => <li key={pack.id}><Link to={'/packs/' + pack.id}>{pack.title} <span aria-hidden="true">↗</span></Link><div><span>{categories[pack.categoryId] ?? t('packs.categoryUnavailable')}</span><span>{pack.ownerName}</span><time dateTime={pack.createdAt.toDate().toISOString()}>{pack.createdAt.toDate().toLocaleString(i18n.resolvedLanguage)}</time></div></li>)}</ul>
      <nav className="account-actions" aria-label={t('packs.pagination')}><button className="button" disabled={current.index === 0 || current.status !== 'ready'} onClick={previousPage}>{t('packs.previousPage')}</button><p aria-live="polite">{t('packs.pageNumber', { page: current.index + 1 })}</p><button className="button" disabled={!current.nextCursor || current.status !== 'ready'} onClick={nextPage}>{t('packs.nextPage')}</button></nav>
    </>}
  </AccountLayout>;
}

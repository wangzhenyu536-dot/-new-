import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AccountLayout } from '../components/AccountLayout';
import { MemberBar } from '../components/MemberBar';
import { useAuth } from '../app/useAuth';
import { db } from '../app/firebase';
import { listSparkPacks, type SparkPack } from '../services/spark-materials';

export function SparkWorkspacePage({ upcoming = false }: { upcoming?: boolean }) {
  const { t, i18n } = useTranslation(), { profile } = useAuth();
  const [packs, setPacks] = useState<SparkPack[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (upcoming) return;
    let active = true;
    setPacks([]); setStatus('loading');
    void listSparkPacks(db).then(saved => {
      if (active) { setPacks(saved); setStatus('ready'); }
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [upcoming, retry]);
  return <AccountLayout><MemberBar />
    <h1>{t(upcoming ? 'spark.upcomingTitle' : 'spark.workspaceTitle')}</h1>
    <p>{t(upcoming ? 'spark.upcomingHint' : 'spark.workspaceHint')}</p>
    {upcoming && <section className="preview-status"><strong>{profile?.displayName}</strong><p>{t('spark.available')}</p><small>{t('spark.next')}</small></section>}
    <nav className="account-actions" aria-label={t('account.workspaceNav')}>
      <Link className="button" to="/categories">{t('spark.categoriesTitle')} <span aria-hidden="true">↗</span></Link>
      <Link className="button button-dark" to={upcoming ? '/packs' : '/packs/new'}>{t(upcoming ? 'spark.workspaceTitle' : 'createTitle')} <span aria-hidden="true">↗</span></Link>
    </nav>
    {!upcoming && <>
      <p className="pack-shared">{t('packs.shared')}</p>
      <p className="pack-sort-note">{t('packs.newestFirst')}</p>
      {status === 'loading' && <p role="status">{t('packs.loading')}</p>}
      {status === 'error' && <div role="alert"><p>{t('packs.loadError')}</p><button className="button" onClick={() => setRetry(value => value + 1)}>{t('account.retry')}</button></div>}
      {status === 'ready' && !packs.length && <p className="pack-empty">{t('packs.empty')}</p>}
      <ul className="pack-list">{packs.map(pack => <li key={pack.id}>
        <Link to={'/packs/' + pack.id}>{pack.title} <span aria-hidden="true">↗</span></Link>
        <div><span>{pack.ownerName}</span><time dateTime={pack.createdAt.toDate().toISOString()}>{pack.createdAt.toDate().toLocaleString(i18n.resolvedLanguage)}</time></div>
      </li>)}</ul>
    </>}
  </AccountLayout>;
}

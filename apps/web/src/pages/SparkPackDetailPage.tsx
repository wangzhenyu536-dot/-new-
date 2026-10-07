import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { ATTACHMENT_LIMITS, checkImageHeader, validateText, type EegResult, type Issue } from '@evertrace/shared';
import { db } from '../app/firebase';
import { useAuth } from '../app/useAuth';
import { useSparkDownloads } from '../components/SparkDownloads';
import { SparkDeletePackButton, SparkPendingOperations, type SparkManagementResult } from '../components/SparkManagementControls';
import { AccountLayout } from '../components/AccountLayout';
import { MemberBar } from '../components/MemberBar';
import { IssueList } from '../components/IssueList';
import { EegPreview } from '../components/EegPreview';
import { parseEegInWorker } from '../services/eeg-worker';
import { readSparkFile, readSparkPack, SparkMaterialError, type SparkFileMeta } from '../services/spark-materials';

type Detail = Awaited<ReturnType<typeof readSparkPack>>;
type MaterialView = {
  status: 'loading' | 'ready' | 'error' | 'invalid';
  issues: Issue[]; text?: string; imageUrl?: string; eeg?: EegResult;
};

function SparkStoredMaterial({ packId, version, file, downloadControls }: { packId: string; version: number; file: SparkFileMeta; downloadControls: (file: SparkFileMeta, ready: boolean) => ReactNode }) {
  const { t } = useTranslation();
  const [view, setView] = useState<MaterialView>({ status: 'loading', issues: [] });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let imageUrl: string | undefined;
    setView({ status: 'loading', issues: [] });
    void readSparkFile(db, packId, version, file).then(async bytes => {
      controller.signal.throwIfAborted();
      if (file.kind === 'text') {
        const checked = validateText(bytes, file.name);
        setView(checked.ok ? { status: 'ready', text: checked.text, issues: [] } : { status: 'invalid', issues: checked.issues });
        return;
      }
      if (file.kind === 'image') {
        const issues = checkImageHeader(bytes, file.name);
        if (issues.length) { setView({ status: 'invalid', issues }); return; }
        const blob = new Blob([bytes.slice().buffer], { type: file.mediaType });
        let valid: boolean;
        try {
          const bitmap = await createImageBitmap(blob);
          valid = bitmap.width * bitmap.height <= ATTACHMENT_LIMITS.imagePixels;
          bitmap.close();
        } catch {
          controller.signal.throwIfAborted();
          setView({ status: 'invalid', issues: [{ code: 'imageInvalid', file: file.name }] });
          return;
        }
        controller.signal.throwIfAborted();
        if (!valid) { setView({ status: 'invalid', issues: [{ code: 'imageInvalid', file: file.name }] }); return; }
        imageUrl = URL.createObjectURL(blob);
        setView({ status: 'ready', issues: [], imageUrl });
        return;
      }
      // The worker copies bytes before transfer; an original remains unchanged.
      const eeg = await parseEegInWorker(bytes, file.name, controller.signal);
      controller.signal.throwIfAborted();
      setView({ status: eeg.ok ? 'ready' : 'invalid', issues: eeg.issues, eeg });
    }).catch(() => { if (!controller.signal.aborted) setView({ status: 'error', issues: [] }); });
    return () => { controller.abort(); if (imageUrl) URL.revokeObjectURL(imageUrl); };
  }, [packId, version, file, retry]);
  return <section className="pack-section stored-material">
    <h2>{file.name}</h2>
    <p className="field-note">{t(file.kind === 'eeg' ? 'packs.originalEeg' : file.kind === 'image' ? 'packs.originalImage' : 'packs.originalText')} · {file.size.toLocaleString()} B</p>
    {downloadControls(file, view.status === 'ready')}
    {view.status === 'loading' && <p role="status">{t('packs.fileLoading')}</p>}
    {view.status === 'error' && <div role="alert"><p>{t('packs.fileError')}</p><button className="button" onClick={() => setRetry(value => value + 1)}>{t('packs.retryFile')}</button></div>}
    <IssueList issues={view.issues} />
    {view.status === 'invalid' && <button className="button" onClick={() => setRetry(value => value + 1)}>{t('packs.retryFile')}</button>}
    {view.status === 'ready' && (file.kind === 'image'
      ? <img className="pack-image" src={view.imageUrl} alt={file.name} onError={() => setView({ status: 'invalid', issues: [{ code: 'imageInvalid', file: file.name }] })} />
      : file.kind === 'text' ? <pre className="pack-text">{view.text}</pre> : view.eeg && <EegPreview result={view.eeg} />)}
  </section>;
}

export function SparkPackDetailPage() {
  const { id } = useParams(), { t, i18n } = useTranslation(), access = useAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error' | 'deleting' | 'deleted'>('loading');
  const [retry, setRetry] = useState(0);
  const downloads = useSparkDownloads(detail), [deletionBusy, setDeletionBusy] = useState(''), alive = useRef(true), ownDeletion = useRef(''), currentId = useRef(id); currentId.current = id;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function deletionResult(packId: string, result: SparkManagementResult) {
    if (!alive.current || currentId.current !== packId) return;
    ownDeletion.current = packId; setDetail(null); setStatus(result.status === 'done' ? 'deleted' : 'deleting'); setDeletionBusy(result.running ? result.operationId : '');
  }
  useEffect(() => {
    let active = true, revoked = false;
    ownDeletion.current = ''; setDetail(null); setStatus('loading'); setDeletionBusy('');
    if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) { setStatus('missing'); return; }
    const root = doc(db, 'packs', id);
    const stop = onSnapshot(root, { includeMetadataChanges: true }, snapshot => {
      // A local cache or an unconfirmed write cannot revoke or confirm access.
      if (!active || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      if (!snapshot.exists() || snapshot.get('status') !== 'ready') {
        revoked = true; setDetail(null);
        const cleaning = snapshot.exists() && snapshot.get('status') === 'deleting' && (snapshot.get('ownerId') === access.user?.uid || access.profile?.role === 'admin');
        setStatus(cleaning ? 'deleting' : ownDeletion.current === id ? 'deleted' : 'missing');
      }
    }, error => {
      if (!active) return;
      revoked = true; setDetail(null); setDeletionBusy('');
      setStatus(error.code === 'permission-denied' ? ownDeletion.current === id ? 'deleted' : 'missing' : 'error');
    });
    void readSparkPack(db, id).then(saved => {
      if (active && !revoked) { setDetail(saved); setStatus('ready'); }
    }).catch(async error => {
      if (!active || revoked) return;
      const unavailable = error instanceof SparkMaterialError && error.code === 'notFound' || (error as { code?: string }).code === 'permission-denied';
      if (!unavailable) { setStatus('error'); return; }
      try {
        const saved = await getDocFromServer(root);
        if (active && !revoked) setStatus(saved.exists() && saved.get('status') === 'deleting' && (saved.get('ownerId') === access.user?.uid || access.profile?.role === 'admin') ? 'deleting' : 'missing');
      } catch { if (active && !revoked) setStatus('missing'); }
    });
    return () => { active = false; stop(); };
  }, [id, retry, access.user?.uid, access.profile?.role]);
  return <AccountLayout><MemberBar />
    {status === 'loading' && <p role="status">{t('packs.loading')}</p>}
    {status === 'deleted' && <h1>{t('management.packDeleted')}</h1>}
    {status === 'deleting' && <><h1>{t('management.packCleanup')}</h1><p>{t('management.pendingHint')}</p></>}
    {status === 'missing' && <><h1>{t('packs.notFound')}</h1><p>{t('packs.notFoundHint')}</p></>}
    {status === 'error' && <div role="alert"><h1>{t('packs.detailError')}</h1><button className="button" onClick={() => setRetry(value => value + 1)}>{t('account.retry')}</button></div>}
    {status === 'ready' && detail && <>
      <h1 className="pack-detail-title">{detail.pack.title}</h1>
      {(detail.pack.ownerId === access.user?.uid || access.profile?.role === 'admin') && <SparkDeletePackButton packId={detail.pack.id} title={detail.pack.title} version={detail.pack.version} onResult={result => deletionResult(detail.pack.id, result)} />}
      {(detail.pack.ownerId === access.user?.uid || access.profile?.role === 'admin') && <Link className="button" to={'/packs/' + detail.pack.id + '/edit'}>{t('packs.edit')}</Link>}
      {downloads.controls}
      <dl className="pack-detail-meta">
        <div><dt>{t('form.category')}</dt><dd>{detail.category || t('packs.categoryUnavailable')}</dd></div>
        <div><dt>{t('packs.creator')}</dt><dd>{detail.pack.ownerName}</dd></div>
        <div><dt>{t('packs.created')}</dt><dd><time dateTime={detail.pack.createdAt.toDate().toISOString()}>{detail.pack.createdAt.toDate().toLocaleString(i18n.resolvedLanguage)}</time></dd></div>
      </dl>
      <p className="pack-shared">{t('packs.shared')}</p>
      {detail.pack.textContent.trim() && <section className="pack-section"><h2>{t('form.notes')}</h2><pre className="pack-text">{detail.pack.textContent}</pre></section>}
      {detail.files.map(file => <SparkStoredMaterial key={detail.pack.id + '/' + detail.pack.version + '/' + file.slot} packId={detail.pack.id} version={detail.pack.version} file={file} downloadControls={downloads.fileControls} />)}
    </>}
    <SparkPendingOperations packId={id} busyOperation={deletionBusy} onDone={result => { if (id) deletionResult(id, result); }} />
    <Link className="pack-back" to="/packs">{t('browseTitle')} <span aria-hidden="true">↗</span></Link>
  </AccountLayout>;
}

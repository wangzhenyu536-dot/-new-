import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ATTACHMENT_LIMITS, checkImageHeader, validateText, type EegResult, type Issue } from '@evertrace/shared';
import { db } from '../app/firebase';
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

function deliverOriginal(bytes: Uint8Array, file: SparkFileMeta) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: file.mediaType }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = file.name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SparkStoredMaterial({ packId, version, file }: { packId: string; version: number; file: SparkFileMeta }) {
  const { t } = useTranslation();
  const [view, setView] = useState<MaterialView>({ status: 'loading', issues: [] });
  const [retry, setRetry] = useState(0), [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false), [downloadComplete, setDownloadComplete] = useState(false);
  const active = useRef(true), downloadController = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; downloadController.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let imageUrl: string | undefined;
    setView({ status: 'loading', issues: [] }); setDownloadError(false); setDownloadComplete(false);
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
  async function download() {
    if (downloadController.current || view.status !== 'ready') return;
    const controller = new AbortController(); downloadController.current = controller;
    setDownloading(true); setDownloadError(false); setDownloadComplete(false);
    try {
      const bytes = await readSparkFile(db, packId, version, file);
      controller.signal.throwIfAborted();
      if (active.current) { deliverOriginal(bytes, file); setDownloadComplete(true); }
    } catch {
      if (active.current && !controller.signal.aborted) setDownloadError(true);
    } finally {
      if (downloadController.current === controller) downloadController.current = null;
      if (active.current) setDownloading(false);
    }
  }
  return <section className="pack-section stored-material">
    <h2>{file.name}</h2>
    <p className="field-note">{t(file.kind === 'eeg' ? 'packs.originalEeg' : file.kind === 'image' ? 'packs.originalImage' : 'packs.originalText')} · {file.size.toLocaleString()} B</p>
    <div className="file-downloads"><button className="button" disabled={downloading || view.status !== 'ready'} onClick={() => void download()}>{t('download.original')}</button></div>
    {downloading && <p role="status">{t('download.reading', { name: file.name, done: 0, total: 1 })}</p>}
    {downloadComplete && <p role="status">{t('download.complete')}</p>}
    {downloadError && <div role="alert"><p>{t('download.exportFailed')}</p><button className="button" disabled={downloading} onClick={() => void download()}>{t('download.retry')}</button></div>}
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
  const { id } = useParams(), { t, i18n } = useTranslation();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setDetail(null); setStatus('loading');
    if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) { setStatus('missing'); return; }
    void readSparkPack(db, id).then(saved => {
      if (active) { setDetail(saved); setStatus('ready'); }
    }).catch(error => {
      if (active) setStatus(error instanceof SparkMaterialError && error.code === 'notFound' ? 'missing' : 'error');
    });
    return () => { active = false; };
  }, [id, retry]);
  return <AccountLayout><MemberBar />
    {status === 'loading' && <p role="status">{t('packs.loading')}</p>}
    {status === 'missing' && <><h1>{t('packs.notFound')}</h1><p>{t('packs.notFoundHint')}</p></>}
    {status === 'error' && <div role="alert"><h1>{t('packs.detailError')}</h1><button className="button" onClick={() => setRetry(value => value + 1)}>{t('account.retry')}</button></div>}
    {status === 'ready' && detail && <>
      <h1 className="pack-detail-title">{detail.pack.title}</h1>
      <dl className="pack-detail-meta">
        <div><dt>{t('form.category')}</dt><dd>{detail.category || t('packs.categoryUnavailable')}</dd></div>
        <div><dt>{t('packs.creator')}</dt><dd>{detail.pack.ownerName}</dd></div>
        <div><dt>{t('packs.created')}</dt><dd><time dateTime={detail.pack.createdAt.toDate().toISOString()}>{detail.pack.createdAt.toDate().toLocaleString(i18n.resolvedLanguage)}</time></dd></div>
      </dl>
      <p className="pack-shared">{t('packs.shared')}</p>
      {detail.pack.textContent.trim() && <section className="pack-section"><h2>{t('form.notes')}</h2><pre className="pack-text">{detail.pack.textContent}</pre></section>}
      {detail.files.map(file => <SparkStoredMaterial key={detail.pack.id + '/' + detail.pack.version + '/' + file.slot} packId={detail.pack.id} version={detail.pack.version} file={file} />)}
    </>}
    <Link className="pack-back" to="/packs">{t('browseTitle')} <span aria-hidden="true">↗</span></Link>
  </AccountLayout>;
}

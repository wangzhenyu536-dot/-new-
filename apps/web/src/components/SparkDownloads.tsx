import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../app/firebase';
import { deliverDownload } from '../services/export-render';
import type { ExportProgress } from '../services/export-pack';
import { exportSparkMaterial, sparkExportDependencies, type SparkExportAction, type SparkExportDetail } from '../services/spark-export';
import type { SparkFileMeta } from '../services/spark-materials';

export function useSparkDownloads(detail: SparkExportDetail | null) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [complete, setComplete] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const controller = useRef<AbortController | null>(null), last = useRef<SparkExportAction | null>(null), active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => { controller.current?.abort(); last.current = null; setError(''); setComplete(false); }, [detail]);
  async function start(action: SparkExportAction) {
    if (!detail || controller.current) return;
    const current = new AbortController(); controller.current = current; last.current = action;
    setBusy(true); setError(''); setComplete(false); setProgress(null);
    try {
      const result = await exportSparkMaterial(detail, action, i18n.resolvedLanguage ?? 'en', sparkExportDependencies(db, detail), current.signal, value => {
        if (active.current && controller.current === current) setProgress(value);
      });
      current.signal.throwIfAborted();
      if (active.current && controller.current === current) { deliverDownload(result.bytes, result.name, result.mediaType); setComplete(true); }
    } catch (cause) {
      if (active.current && controller.current === current) setError(current.signal.aborted ? 'exportCancelled' : cause instanceof Error && ['exportChanged', 'exportIntegrity', 'exportInvalid', 'exportBudget'].includes(cause.message) ? cause.message : 'exportFailed');
    } finally {
      if (controller.current === current) {
        controller.current = null;
        if (active.current) { setBusy(false); setProgress(null); }
      }
    }
  }
  const controls = <div className="pack-downloads">
    <button className="button button-dark" disabled={busy || !detail} onClick={() => void start({ kind: 'zip' })}>{t('download.zip')}</button>
    {busy && <><p role="status">{progress ? t('download.' + progress.phase, { name: progress.name ?? '', done: progress.done, total: progress.total }) : t('download.preparing')}</p><button className="button" onClick={() => controller.current?.abort()}>{t('download.cancel')}</button></>}
    {complete && <p role="status">{t('download.complete')}</p>}
    {error && <div role="alert"><p>{t('download.' + error)}</p>{error === 'exportChanged' ? <button className="button" onClick={() => location.reload()}>{t('download.reload')}</button> : <button className="button" disabled={busy} onClick={() => { if (last.current) void start(last.current); }}>{t('download.retry')}</button>}</div>}
    <p className="field-note">{t('download.fullRange')}</p>
  </div>;
  function fileControls(file: SparkFileMeta, ready = true) {
    return <div className="file-downloads"><button className="button" disabled={busy || !detail || !ready} onClick={() => void start({ kind: 'original', file })}>{t('download.original')}</button>{file.kind === 'eeg' && <button className="button" disabled={busy || !detail || !ready} onClick={() => void start({ kind: 'png', file })}>{t('download.png')}</button>}</div>;
  }
  return { controls, fileControls };
}

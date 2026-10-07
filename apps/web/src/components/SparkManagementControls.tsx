import { useEffect, useRef, useState, type ReactNode } from 'react';
import { collection, documentId, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../app/useAuth';
import { db } from '../app/firebase';
import { beginSparkPackDelete, resumeSparkOperation, SparkManagementError, type SparkOperation } from '../services/spark-management';

export type SparkManagementResult = { operationId: string; status: 'pending' | 'done'; moved: number; running?: boolean };
export function sparkManagementError(error: unknown): string {
  const code = error instanceof SparkManagementError ? error.code : (error as { code?: string } | null)?.code;
  if (['forbidden', 'permission-denied', 'firestore/permission-denied'].includes(code ?? '')) return 'management.permissionDenied';
  if (code === 'categoryExists') return 'management.nameExists';
  if (code === 'categoryInvalid') return 'validation.categoryInvalid';
  if (['versionConflict', 'categoryChanged', 'categoryUnavailable', 'targetRequired', 'operationChanged', 'baselineRequired', 'notFound'].includes(code ?? '')) return 'management.' + code;
  if (code === 'confirmation') return 'management.invalid';
  return 'management.failed';
}
export function SparkConfirmationDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const element = dialog.current!, previous = document.activeElement as HTMLElement | null; element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  return <dialog className="management-dialog" ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) close.current(); }}><h2>{title}</h2>{children}</dialog>;
}
export function SparkDeletePackButton({ packId, title, version, onResult }: { packId: string; title: string; version: number; onResult: (result: SparkManagementResult) => void }) {
  const { t } = useTranslation(), uid = useAuth().user?.uid;
  const [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function remove() {
    if (inFlight.current || !confirmed || !uid) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const operation = await beginSparkPackDelete(db, uid, packId, version, packId);
      if (alive.current) setOpen(false);
      // Access is revoked at the first commit. The detail stops exposing materials
      // while the persisted operation continues independently of this dialog.
      onResult({ operationId: operation.id, status: operation.status, moved: operation.moved, running: operation.status === 'pending' });
      if (operation.status !== 'done') {
        try { onResult(await resumeSparkOperation(db, uid, operation.id)); }
        catch { onResult({ operationId: operation.id, status: 'pending', moved: operation.moved }); }
      }
    } catch (failure) { if (alive.current) setError(sparkManagementError(failure)); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  return <><button className="button button-danger" onClick={() => { setConfirmed(false); setError(''); setOpen(true); }}>{t('management.deletePack')}</button>{open && <SparkConfirmationDialog title={t('management.confirmDeletePack')} busy={busy} onClose={() => setOpen(false)}><p className="management-warning">{t('management.packWarning')}</p><p className="management-target">{title}</p><fieldset disabled={busy}><label className="management-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t('management.understand')}</label>{error && <p role="alert">{t(error)}</p>}{busy && <p role="status">{t('management.deleting')}</p>}<div className="account-actions"><button className="button" onClick={() => setOpen(false)}>{t('management.cancel')}</button><button className="button button-danger" disabled={!confirmed} onClick={() => void remove()}>{t('management.deletePermanently')}</button></div></fieldset></SparkConfirmationDialog>}</>;
}
export function SparkPendingOperations({ packId, busyOperation = '', onDone }: { packId?: string; busyOperation?: string; onDone?: (result: SparkManagementResult) => void }) {
  const { t } = useTranslation(), access = useAuth(), uid = access.user?.uid, role = access.profile?.role;
  const [jobs, setJobs] = useState<SparkOperation[]>([]), [loadError, setLoadError] = useState(false), [retry, setRetry] = useState(0), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<{ moved: number; phase: string } | null>(null), inFlight = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setJobs([]); setLoadError(false); setError(''); setNotice('');
    if (!uid || !role) return;
    const filters = [where('status', '==', 'pending'), ...(role === 'admin' ? [] : [where('ownerId', '==', uid), where('kind', '==', 'deletePack')])];
    return onSnapshot(query(collection(db, 'sparkOperations'), ...filters, orderBy('updatedAt', 'desc'), orderBy(documentId(), 'desc')), snapshot => setJobs(snapshot.docs.map(saved => ({ ...saved.data(), id: saved.id } as SparkOperation))), () => setLoadError(true));
  }, [uid, role, retry]);
  async function resume(id: string) {
    if (inFlight.current || busyOperation || !uid) return;
    inFlight.current = true; setBusy(id); setError(''); setNotice(''); setProgress(null);
    try {
      const result = await resumeSparkOperation(db, uid, id, value => { if (alive.current) setProgress(value); });
      if (alive.current) { setNotice(result.status === 'done' ? 'management.completed' : 'management.pending'); if (result.status === 'done') onDone?.(result); }
    } catch (failure) { if (alive.current) { setError(sparkManagementError(failure)); setNotice('management.pending'); } }
    finally { inFlight.current = false; if (alive.current) { setBusy(''); setProgress(null); } }
  }
  const shown = packId ? jobs.filter(job => job.packId === packId) : jobs;
  return <>{loadError && <div role="alert"><p>{t('management.jobsError')}</p><button className="button" onClick={() => setRetry(value => value + 1)}>{t('account.retry')}</button></div>}{shown.length > 0 && <section className="pending-operations"><h2>{t('management.pendingTitle')}</h2><p>{t('management.pendingHint')}</p>{shown.map(job => <div className="pending-operation" key={job.id}><p>{t(job.kind === 'deletePack' ? 'management.packCleanup' : 'management.categoryMigration')}{job.kind === 'deleteCategory' && ' · ' + t('management.moved', { count: job.id === busy && progress ? progress.moved : job.moved })}<small>{t('management.reference')}: {job.packId || job.sourceId}</small></p><button className="button" disabled={Boolean(busy || busyOperation)} onClick={() => void resume(job.id)}>{t(busy === job.id || busyOperation === job.id ? 'account.working' : 'management.retryCleanup')}</button></div>)}</section>}{error && <p role="alert">{t(error)}</p>}{notice && <p role="status">{t(notice)}</p>}</>;
}

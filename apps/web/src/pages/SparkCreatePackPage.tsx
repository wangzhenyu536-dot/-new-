import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { ATTACHMENT_LIMITS, PREVIEW_LIMITS, checkImageHeader, validatePackInput, validateText, type EegResult, type FileKind, type Issue } from '@evertrace/shared';
import { db } from '../app/firebase';
import { useAuth } from '../app/useAuth';
import { AccountLayout } from '../components/AccountLayout';
import { MemberBar } from '../components/MemberBar';
import { EegPreview } from '../components/EegPreview';
import { IssueList } from '../components/IssueList';
import { createSparkCategory } from '../services/spark-account';
import { parseEegInWorker } from '../services/eeg-worker';
import { SPARK_LIMITS, SparkMaterialError, saveSparkMaterials, type SparkAttempt, type SparkProgress } from '../services/spark-materials';

type Category = { id: string; name: string };
type Material = { key: string; kind: FileKind; file: File; busy: boolean; issues: Issue[]; eeg?: EegResult };
function LocalImage({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value); }, [file]);
  return url ? <img className="pack-image" src={url} alt={file.name} /> : null;
}
export function SparkCreatePackPage() {
  const { t } = useTranslation(), navigate = useNavigate(), access = useAuth();
  const [title, setTitle] = useState(''), [notes, setNotes] = useState(''), [categoryId, setCategoryId] = useState(''), [newCategory, setNewCategory] = useState('');
  const [categories, setCategories] = useState<Category[]>([]), [categoryStatus, setCategoryStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [categoryRetry, setCategoryRetry] = useState(0);
  const [adding, setAdding] = useState(false), [categoryError, setCategoryError] = useState(''), [categoryNotice, setCategoryNotice] = useState('');
  const [materials, setMaterials] = useState<Material[]>([]), [formIssues, setFormIssues] = useState<Issue[]>([]), [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(''), [progress, setProgress] = useState<SparkProgress | null>(null);
  const alive = useRef(true), saveBusy = useRef(false), commitStarted = useRef(false), saveController = useRef<AbortController | null>(null), attempt = useRef<SparkAttempt | null>(null);
  const checks = useRef(new Map<string, AbortController>()), inputs = useRef<Partial<Record<FileKind, HTMLInputElement | null>>>({});
  function changed() { setChecked(false); setFormIssues([]); setSaveError(''); }
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; saveController.current?.abort(); for (const controller of checks.current.values()) controller.abort(); checks.current.clear(); };
  }, []);
  useEffect(() => onSnapshot(query(collection(db, 'categories'), where('status', '==', 'active')), snapshot => {
    setCategories(snapshot.docs.map(saved => ({ id: saved.id, name: String(saved.get('name')) })).sort((a, b) => a.name.localeCompare(b.name)));
    setCategoryStatus('ready'); setChecked(false);
  }, () => setCategoryStatus('error')), [categoryRetry]);
  async function addCategory() {
    if (adding || !access.user) return;
    setCategoryError(''); setCategoryNotice(''); setAdding(true);
    try {
      const result = await createSparkCategory(db, access.user.uid, newCategory);
      if (!alive.current) return;
      setCategories(previous => previous.some(category => category.id === result.id) ? previous : [...previous, { id: result.id, name: result.name }]);
      setCategoryId(result.id); setNewCategory(''); setCategoryNotice(result.created ? 'form.categoryAdded' : 'form.categoryExists'); changed();
    } catch (error) { if (alive.current) setCategoryError(error instanceof Error && error.message === 'categoryInvalid' ? 'validation.categoryInvalid' : 'form.categoryError'); }
    finally { if (alive.current) setAdding(false); }
  }
  async function checkFile(material: Material) {
    const controller = new AbortController(), { file, kind, key } = material;
    checks.current.set(key, controller);
    let issues: Issue[] = [], eeg: EegResult | undefined;
    try {
      if (file.size > SPARK_LIMITS.fileBytes) issues.push({ code: 'sparkFileSize', file: file.name });
      if (!file.name || file.name.length > 160 || /[/\\]/.test(file.name) || [...file.name].some(character => { const code = character.charCodeAt(0); return code < 32 || code === 127; })) issues.push({ code: 'fileName', file: file.name });
      if (!issues.length) {
        const bytes = new Uint8Array(await file.arrayBuffer()); controller.signal.throwIfAborted();
        if (kind === 'text') issues = validateText(bytes, file.name).issues;
        else if (kind === 'image') {
          issues = checkImageHeader(bytes, file.name);
          if (!issues.length) {
            try {
              const bitmap = await createImageBitmap(file), valid = bitmap.width > 0 && bitmap.height > 0 && bitmap.width * bitmap.height <= ATTACHMENT_LIMITS.imagePixels;
              bitmap.close(); if (!valid) issues = [{ code: 'imageInvalid', file: file.name }];
            } catch { issues = [{ code: 'imageInvalid', file: file.name }]; }
          }
        } else { eeg = await parseEegInWorker(bytes, file.name, controller.signal); issues = eeg.issues; }
      }
    } catch { if (controller.signal.aborted) return; issues = [{ code: 'fileRead', file: file.name }]; }
    finally { checks.current.delete(key); }
    if (alive.current && !controller.signal.aborted) setMaterials(previous => previous.map(selected => selected.key === key ? { ...selected, busy: false, issues, eeg } : selected));
  }
  function choose(kind: FileKind, files: File[]) {
    changed();
    for (const material of materials.filter(selected => selected.kind === kind)) checks.current.get(material.key)?.abort();
    const selected = files.map(file => ({ key: crypto.randomUUID(), kind, file, busy: true, issues: [] }));
    setMaterials(previous => [...previous.filter(material => material.kind !== kind), ...selected]);
    for (const material of selected) void checkFile(material);
  }
  function remove(key: string) { changed(); checks.current.get(key)?.abort(); setMaterials(previous => previous.filter(material => material.key !== key)); }
  function currentIssues() {
    const valid = materials.filter(material => !material.busy && !material.issues.length);
    const selectedCategory = categories.some(category => category.id === categoryId) ? categoryId : '';
    const issues = validatePackInput({ title, categoryId: selectedCategory, text: notes, textFileValid: valid.some(material => material.kind === 'text'), eegValid: valid.some(material => material.kind === 'eeg') });
    issues.push(...materials.flatMap(material => material.busy ? [{ code: 'checking' as const, file: material.file.name }] : material.issues));
    if (materials.length > SPARK_LIMITS.count || materials.reduce((total, material) => total + material.file.size, 0) > SPARK_LIMITS.totalBytes) issues.push({ code: 'sparkAttachmentLimit' });
    return issues;
  }
  const busy = materials.some(material => material.busy);
  function check(event: FormEvent) { event.preventDefault(); if (saveBusy.current) return; const issues = currentIssues(); setFormIssues(issues); setChecked(!issues.length); }
  async function save() {
    if (saveBusy.current || busy || !access.user) return;
    const issues = currentIssues(); setFormIssues(issues); setSaveError(''); if (issues.length) return;
    saveBusy.current = true; commitStarted.current = false; setSaving(true); setProgress({ phase: 'preparing', percent: 0 });
    const controller = new AbortController(); saveController.current = controller;
    try {
      const result = await saveSparkMaterials(db, access.user.uid, { title, categoryId, textContent: notes, attachments: materials.map(material => ({ file: material.file, kind: material.kind })) }, attempt,
        state => { if (state.phase === 'committing') commitStarted.current = true; if (alive.current) setProgress(state); }, controller.signal, { parseEeg: parseEegInWorker });
      if (alive.current) navigate('/packs/' + result.packId);
    } catch (error) {
      if (!alive.current) return;
      if (controller.signal.aborted && !commitStarted.current) setSaveError('sparkMaterials.cancelled');
      else if (error instanceof SparkMaterialError && error.code === 'validation') setFormIssues(error.issues);
      else setSaveError(error instanceof SparkMaterialError && error.code === 'categoryUnavailable' ? 'packs.categoryBusy' : 'packs.saveError');
    } finally { saveBusy.current = false; saveController.current = null; if (alive.current) { setSaving(false); setProgress(null); } }
  }
  function group(kind: FileKind) {
    const selected = materials.filter(material => material.kind === kind), label = kind === 'text' ? 'form.textFile' : kind === 'eeg' ? 'form.eegFile' : 'form.images';
    const inputId = 'pack-' + (kind === 'eeg' ? 'eeg' : kind === 'text' ? 'text' : 'images');
    return <><label htmlFor={inputId}>{t(label)}</label><div className="file-picker"><span className="picker-action">{t('form.chooseFile')}</span><span className="picker-name">{selected.length ? selected.map(material => material.file.name).join(', ') : t('form.noFile')}</span><input id={inputId} ref={element => { inputs.current[kind] = element; }} type="file" multiple accept={kind === 'text' ? '.txt' : kind === 'eeg' ? '.xlsx' : '.jpg,.jpeg,.png,.webp'} onChange={event => choose(kind, Array.from(event.target.files ?? []))} /></div><p className="field-note">{t('form.multipleHint')}</p>{selected.map(material => <div className="attachment-card" key={material.key}><h3>{material.file.name}</h3>{material.busy && <p role="status">{t(kind === 'text' ? 'form.checkingText' : kind === 'eeg' ? 'form.checkingEeg' : 'form.checkingImage')}</p>}<IssueList issues={material.issues} />{!material.busy && !material.issues.length && (kind === 'text' ? <p className="file-valid">{t('form.textValid')} · {material.file.name}</p> : kind === 'image' ? <LocalImage file={material.file} /> : material.eeg && <EegPreview result={material.eeg} />)}<button className="file-remove" type="button" onClick={() => { remove(material.key); if (selected.length === 1 && inputs.current[kind]) inputs.current[kind]!.value = ''; }}>{selected.length === 1 && kind !== 'image' ? t(kind === 'text' ? 'form.removeText' : 'form.removeEeg') : t('form.removeAttachment', { name: material.file.name })}</button></div>)}</>;
  }
  return <AccountLayout><MemberBar /><h1>{t('createTitle')}</h1><p className="pack-intro">{t('sparkMaterials.intro')}</p><div className="template-notice"><p>{t('sparkMaterials.templateNotice')}</p><p>{t('sparkMaterials.limits', { rows: PREVIEW_LIMITS.rows.toLocaleString(), chars: PREVIEW_LIMITS.textChars.toLocaleString() })}</p></div>
    <form className="pack-form" onSubmit={check}><fieldset className="pack-fields" disabled={saving}>
      <section className="pack-section"><h2>{t('form.identity')}</h2><label htmlFor="pack-title">{t('form.title')}</label><input id="pack-title" value={title} maxLength={PREVIEW_LIMITS.titleChars} onChange={event => { setTitle(event.target.value); changed(); }} /><label htmlFor="pack-category">{t('form.category')}</label><select id="pack-category" disabled={categoryStatus !== 'ready'} value={categoryId} onChange={event => { setCategoryId(event.target.value); changed(); }}><option value="">{t(categoryStatus === 'loading' ? 'form.categoriesLoading' : 'form.chooseCategory')}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{categoryStatus === 'ready' && !categories.length && <p className="field-note">{t('form.noCategories')}</p>}{categoryStatus === 'error' && <div role="alert"><p>{t('form.categoriesError')}</p><button type="button" className="button" onClick={() => { setCategoryStatus('loading'); setCategoryRetry(value => value + 1); }}>{t('form.retryCategories')}</button></div>}<div className="new-category"><label htmlFor="new-category">{t('form.newCategory')}</label><div><input id="new-category" maxLength={PREVIEW_LIMITS.categoryChars} value={newCategory} onChange={event => { setNewCategory(event.target.value); setCategoryError(''); setCategoryNotice(''); }} /><button type="button" className="button" disabled={adding || categoryStatus !== 'ready'} onClick={() => void addCategory()}>{t(adding ? 'account.working' : 'form.addCategory')}</button></div><p className="field-note">{t('form.sharedCategory')}</p>{categoryError && <p role="alert">{t(categoryError)}</p>}{categoryNotice && <p aria-live="polite">{t(categoryNotice)}</p>}</div></section>
      <section className="pack-section"><h2>{t('form.textSection')}</h2><label htmlFor="pack-notes">{t('form.notes')}</label><textarea id="pack-notes" rows={7} value={notes} maxLength={PREVIEW_LIMITS.textChars} onChange={event => { setNotes(event.target.value); changed(); }} /><p className="field-note">{t('form.textHint')}</p><div className="sample-links"><a href="/samples/synthetic-notes.txt" download>{t('form.downloadTextExample')}</a></div>{group('text')}</section>
      <section className="pack-section"><h2>{t('form.eegSection')}</h2><p className="field-note">{t('form.eegHint')}</p><div className="sample-links"><a href="/samples/synthetic-eeg-valid.xlsx" download>{t('form.downloadExample')}</a><a href="/samples/synthetic-eeg-empty-value.xlsx" download>{t('form.downloadInvalid')}</a></div>{group('eeg')}</section>
      <section className="pack-section"><h2>{t('form.imageSection')}</h2><p className="field-note">{t('form.imageHint')}</p><div className="sample-links"><a href="/samples/synthetic-image.png" download>{t('form.downloadImageExample')}</a></div>{group('image')}</section>
    </fieldset><div className="pack-review"><IssueList issues={formIssues} />{saveError && <p role="alert">{t(saveError)}</p>}{progress && <p role="status">{t(progress.phase === 'committing' ? 'sparkMaterials.committing' : 'sparkMaterials.preparing')}{progress.file && ` · ${progress.file} · ${progress.percent ?? 0}%`}</p>}{checked && !saving && <p role="status">{t('sparkMaterials.passed')}</p>}<div className="account-actions"><button className="button button-dark" type="submit" disabled={busy || saving}>{t('form.check')}</button><button className="button" type="button" disabled={busy || saving || categoryStatus !== 'ready'} onClick={() => void save()}>{t('form.save')}</button>{saving && <button className="button" type="button" disabled={progress?.phase === 'committing'} onClick={() => { if (!commitStarted.current) saveController.current?.abort(); }}>{t('sparkMaterials.cancel')}</button>}</div><p>{t('sparkMaterials.notSaved')}</p></div></form>
    <Link className="pack-back" to="/packs">{t('browseTitle')} <span aria-hidden="true">↗</span></Link>
  </AccountLayout>;
}

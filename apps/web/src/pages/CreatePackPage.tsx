import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { FirebaseError } from 'firebase/app';
import { PREVIEW_LIMITS, validatePackInput, validateText, type EegResult, type Issue } from '@evertrace/shared';
import { db, functions } from '../app/firebase';
import { AccountLayout } from '../components/AccountLayout';
import { MemberBar } from '../components/MemberBar';
import { EegPreview } from '../components/EegPreview';
type Category = { id: string; name: string };
function IssueList({ issues }: { issues: Issue[] }) {
  const { t } = useTranslation();
  return issues.length ? <div className="form-issues" role="alert"><ul>{issues.map((issue, index) => <li key={index}>{[issue.file, issue.sheet, issue.row && t('form.row', { row: issue.row }), issue.column].filter(Boolean).join(' · ')}{issue.file || issue.row ? ': ' : ''}{t(`validation.${issue.code}`)}</li>)}</ul></div> : null;
}
export function CreatePackPage() {
  const { t } = useTranslation();
  const [title, setTitle] = useState(''), [notes, setNotes] = useState(''), [categoryId, setCategoryId] = useState(''), [newCategory, setNewCategory] = useState('');
  const [categories, setCategories] = useState<Category[]>([]), [categoryStatus, setCategoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [categoryRetry, setCategoryRetry] = useState(0), [adding, setAdding] = useState(false), [categoryError, setCategoryError] = useState(''), [categoryNotice, setCategoryNotice] = useState('');
  const [textFile, setTextFile] = useState<File | null>(null), [textCheck, setTextCheck] = useState<ReturnType<typeof validateText> | null>(null), [textBusy, setTextBusy] = useState(false);
  const [eegFile, setEegFile] = useState<File | null>(null), [eegResult, setEegResult] = useState<EegResult | null>(null), [eegBusy, setEegBusy] = useState(false);
  const [formIssues, setFormIssues] = useState<Issue[]>([]), [checked, setChecked] = useState(false);
  const textInput = useRef<HTMLInputElement>(null), eegInput = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null), timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), eegGeneration = useRef(0), textGeneration = useRef(0);
  const changed = () => { setChecked(false); setFormIssues([]); };
  useEffect(() => onSnapshot(query(collection(db, 'categories'), where('status', '==', 'active')), snapshot => {
    setCategories(snapshot.docs.map(doc => ({ id: doc.id, name: String(doc.data().name) })).sort((a, b) => a.name.localeCompare(b.name)));
    setCategoryStatus('ready'); setChecked(false);
  }, () => setCategoryStatus('error')), [categoryRetry]);
  useEffect(() => () => { eegGeneration.current++; textGeneration.current++; worker.current?.terminate(); clearTimeout(timeout.current); }, []);
  async function addCategory() {
    if (adding) return; setCategoryError(''); setCategoryNotice(''); setAdding(true);
    try {
      const result = await httpsCallable<{ name: string }, { id: string; name: string; created: boolean }>(functions, 'createCategory')({ name: newCategory });
      setCategories(previous => previous.some(x => x.id === result.data.id) ? previous : [...previous, { id: result.data.id, name: result.data.name }]);
      setCategoryId(result.data.id); setNewCategory(''); setCategoryNotice(result.data.created ? 'form.categoryAdded' : 'form.categoryExists'); changed();
    } catch (error) { setCategoryError(error instanceof FirebaseError && error.code === 'functions/invalid-argument' ? 'validation.categoryInvalid' : 'form.categoryError'); }
    finally { setAdding(false); }
  }
  async function chooseText(file: File | null) {
    const ticket = ++textGeneration.current; changed(); setTextFile(file); setTextCheck(null); setTextBusy(Boolean(file));
    if (!file) return;
    let result: ReturnType<typeof validateText>;
    try { result = file.size > PREVIEW_LIMITS.textBytes ? { ok: false, issues: [{ code: 'textSize', file: file.name }] } : validateText(new Uint8Array(await file.arrayBuffer()), file.name); }
    catch { result = { ok: false, issues: [{ code: 'fileRead', file: file.name }] }; }
    if (ticket === textGeneration.current) { setTextCheck(result); setTextBusy(false); }
  }
  async function chooseEeg(file: File | null) {
    const ticket = ++eegGeneration.current; changed(); worker.current?.terminate(); clearTimeout(timeout.current); setEegFile(file); setEegResult(null); setEegBusy(Boolean(file));
    if (!file) return;
    const fail = (code: string) => { if (ticket === eegGeneration.current) { setEegResult({ ok: false, issues: [{ code, file: file.name }] }); setEegBusy(false); worker.current?.terminate(); clearTimeout(timeout.current); } };
    if (file.size > PREVIEW_LIMITS.excelBytes) { fail('fileSize'); return; }
    if (!/\.xlsx$/i.test(file.name)) { fail('fileType'); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); if (ticket !== eegGeneration.current) return;
      const current = new Worker(new URL('../workers/eeg.worker.ts', import.meta.url), { type: 'module' }); worker.current = current;
      timeout.current = setTimeout(() => fail('parseTimeout'), PREVIEW_LIMITS.parseMs);
      current.onmessage = (event: MessageEvent<EegResult>) => { if (ticket !== eegGeneration.current) return; clearTimeout(timeout.current); setEegResult(event.data); setEegBusy(false); current.terminate(); worker.current = null; };
      current.onerror = () => fail('fileRead');
      current.postMessage({ bytes, name: file.name }, [bytes.buffer]);
    } catch { fail('fileRead'); }
  }
  function check(event: FormEvent) {
    event.preventDefault(); const activeCategory = categories.some(x => x.id === categoryId) ? categoryId : '';
    const issues = validatePackInput({ title, categoryId: activeCategory, text: notes, textFileValid: Boolean(textCheck?.ok), eegValid: Boolean(eegResult?.ok) });
    if (textFile && !textCheck?.ok) issues.push(...(textCheck?.issues ?? [{ code: 'checking' }]));
    setFormIssues(issues); setChecked(issues.length === 0);
  }
  return <AccountLayout><MemberBar /><h1>{t('createTitle')}</h1><p className="pack-intro">{t('form.intro')}</p><div className="template-notice"><p>{t('form.templateNotice')}</p><p>{t('form.limits', { excel: PREVIEW_LIMITS.excelBytes / 1024 / 1024, rows: PREVIEW_LIMITS.rows.toLocaleString(), text: PREVIEW_LIMITS.textBytes / 1024 / 1024, chars: PREVIEW_LIMITS.textChars.toLocaleString() })}</p></div>
    <form className="pack-form" onSubmit={check}>
      <section className="pack-section"><h2>{t('form.identity')}</h2><label htmlFor="pack-title">{t('form.title')}</label><input id="pack-title" value={title} maxLength={PREVIEW_LIMITS.titleChars} onChange={event => { setTitle(event.target.value); changed(); }} />
        <label htmlFor="pack-category">{t('form.category')}</label><select id="pack-category" disabled={categoryStatus !== 'ready'} value={categoryId} onChange={event => { setCategoryId(event.target.value); changed(); }}><option value="">{t(categoryStatus === 'loading' ? 'form.categoriesLoading' : 'form.chooseCategory')}</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        {categoryStatus === 'ready' && !categories.length && <p className="field-note">{t('form.noCategories')}</p>}{categoryStatus === 'error' && <div role="alert"><p>{t('form.categoriesError')}</p><button type="button" className="button" onClick={() => { setCategoryStatus('loading'); setCategoryRetry(n => n + 1); }}>{t('form.retryCategories')}</button></div>}
        <div className="new-category"><label htmlFor="new-category">{t('form.newCategory')}</label><div><input id="new-category" maxLength={PREVIEW_LIMITS.categoryChars} value={newCategory} onChange={event => { setNewCategory(event.target.value); setCategoryError(''); setCategoryNotice(''); }} /><button type="button" className="button" disabled={adding || categoryStatus !== 'ready'} onClick={() => void addCategory()}>{t(adding ? 'account.working' : 'form.addCategory')}</button></div><p className="field-note">{t('form.sharedCategory')}</p>{categoryError && <p role="alert">{t(categoryError)}</p>}{categoryNotice && <p aria-live="polite">{t(categoryNotice)}</p>}</div>
      </section>
      <section className="pack-section"><h2>{t('form.textSection')}</h2><label htmlFor="pack-notes">{t('form.notes')}</label><textarea id="pack-notes" rows={7} value={notes} maxLength={PREVIEW_LIMITS.textChars} onChange={event => { setNotes(event.target.value); changed(); }} /><p className="field-note">{t('form.textHint')}</p><label htmlFor="pack-text">{t('form.textFile')}</label><div className="file-picker"><span className="picker-action">{t('form.chooseFile')}</span><span className="picker-name" title={textFile?.name}>{textFile?.name || t('form.noFile')}</span><input id="pack-text" ref={textInput} type="file" accept=".txt" onChange={event => void chooseText(event.target.files?.[0] ?? null)} /></div>{textBusy && <p role="status">{t('form.checkingText')}</p>}{textCheck?.ok && <p className="file-valid">{t('form.textValid')} · {textFile?.name}</p>}<IssueList issues={textCheck?.issues ?? []} />{textFile && <button className="file-remove" type="button" onClick={() => { if (textInput.current) textInput.current.value = ''; void chooseText(null); }}>{t('form.removeText')}</button>}
      </section>
      <section className="pack-section"><h2>{t('form.eegSection')}</h2><p className="field-note">{t('form.eegHint')}</p><div className="sample-links"><a href="/samples/synthetic-eeg-valid.xlsx" download>{t('form.downloadExample')}</a><a href="/samples/synthetic-eeg-empty-value.xlsx" download>{t('form.downloadInvalid')}</a></div><label htmlFor="pack-eeg">{t('form.eegFile')}</label><div className="file-picker"><span className="picker-action">{t('form.chooseFile')}</span><span className="picker-name" title={eegFile?.name}>{eegFile?.name || t('form.noFile')}</span><input id="pack-eeg" ref={eegInput} type="file" accept=".xlsx" onChange={event => void chooseEeg(event.target.files?.[0] ?? null)} /></div>{eegBusy && <p role="status">{t('form.checkingEeg')}</p>}<IssueList issues={eegResult?.issues ?? []} />{eegFile && <button className="file-remove" type="button" onClick={() => { if (eegInput.current) eegInput.current.value = ''; void chooseEeg(null); }}>{t('form.removeEeg')}</button>}{eegResult?.ok && <EegPreview result={eegResult} />}
      </section>
      <div className="pack-review"><IssueList issues={formIssues} />{checked && <p role="status" className="file-valid">{t('form.passed')}</p>}<div className="account-actions"><button className="button button-dark" type="submit" disabled={textBusy || eegBusy}>{t('form.check')}</button><button className="button" type="button" disabled>{t('form.save')}</button></div><p>{t('form.notSaved')}</p></div>
    </form><Link className="pack-back" to="/packs">{t('browseTitle')} ↗</Link>
  </AccountLayout>;
}

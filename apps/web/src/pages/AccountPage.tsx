import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FirebaseError } from 'firebase/app';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../app/firebase';
import { useAuth } from '../app/AuthProvider';
import { AccountLayout } from '../components/AccountLayout';
import { AccountPending, safeReturnTo } from '../components/AccessGate';
export function AccountPage({ mode }: { mode: 'login' | 'register' | 'reset' }) {
  const { t } = useTranslation(), access = useAuth(), [params] = useSearchParams();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [name, setName] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false);
  const returnTo = safeReturnTo(params.get('returnTo')), suffix = `?returnTo=${encodeURIComponent(returnTo)}`;
  if (access.status !== 'ready') return <AccountPending />;
  if (access.user && mode !== 'reset') return <Navigate to={returnTo} replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setError('');
    if (mode === 'register' && password !== confirm) { setError('account.mismatch'); return; }
    setBusy(true);
    try {
      if (mode === 'register') await access.register(email.trim(), password, name.trim());
      else if (mode === 'login') await access.login(email.trim(), password);
      else { await sendPasswordResetEmail(auth, email.trim()); setSent(true); }
    } catch (e) {
      const code = e instanceof FirebaseError ? e.code : '';
      if (mode === 'reset' && code === 'auth/user-not-found') setSent(true);
      else setError(({ 'auth/email-already-in-use': 'account.duplicate', 'auth/invalid-email': 'account.invalidEmail', 'auth/weak-password': 'account.weak', 'auth/invalid-credential': 'account.credentials', 'auth/wrong-password': 'account.credentials', 'auth/user-not-found': 'account.credentials', 'auth/user-disabled': 'account.disabled', 'auth/too-many-requests': 'account.tooMany' } as Record<string, string>)[code] || 'account.network');
    } finally { setBusy(false); }
  }
  return <AccountLayout><h1>{t(mode === 'login' ? 'loginTitle' : mode === 'register' ? 'registerTitle' : 'forgotTitle')}</h1><p className="account-intro">{t(`account.${mode}Hint`)}</p>
    <form className="account-form" onSubmit={e => void submit(e)} aria-busy={busy}>
      {mode === 'register' && <label>{t('account.name')}<input name="name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label>}
      <label>{t('account.email')}<input name="email" type="email" autoComplete="email" required value={email} onChange={e => { setEmail(e.target.value); setSent(false); }} /></label>
      {mode !== 'reset' && <label>{t('account.password')}<input name="password" type="password" required minLength={mode === 'register' ? 6 : undefined} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>}
      {mode === 'register' && <><small>{t('account.passwordHint')}</small><label>{t('account.confirm')}<input name="confirm" type="password" required autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label></>}
      {error && <p className="form-message" role="alert">{t(error)}</p>}{sent && <p className="form-message" role="status">{t('account.resetSent')}</p>}
      <button className="button button-dark" type="submit" disabled={busy}>{t(busy ? 'account.working' : mode === 'login' ? 'account.submitLogin' : mode === 'register' ? 'account.submitRegister' : 'account.submitReset')} <span aria-hidden="true">↗</span></button>
    </form><div className="account-links">{mode === 'login' ? <><Link to={`/register${suffix}`}>{t('account.submitRegister')}</Link><Link to="/forgot-password">{t('forgotTitle')}</Link></> : <Link to={`/login${suffix}`}>{t('account.submitLogin')}</Link>}</div>
  </AccountLayout>;
}

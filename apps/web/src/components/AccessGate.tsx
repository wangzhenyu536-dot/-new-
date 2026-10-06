import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../app/useAuth';
import { AccountRedirect } from './AccountRedirect';
import { AccountLayout } from './AccountLayout';
export function safeReturnTo(value: string | null) { return value && value.length<=4096 && (/^\/packs\?[^#]*$/.test(value) || ['/packs', '/categories', '/packs/new', '/admin/members', '/admin/categories'].includes(value) || /^\/packs\/[A-Za-z0-9_-]{1,100}(?:\/edit)?$/.test(value)) ? value : '/packs'; }
export function AccountPending() {
  const { t } = useTranslation(), access = useAuth(); const [error, setError] = useState(false);
  return <AccountLayout>{access.status === 'loading' ? <p role="status">{t('account.loading')}</p> : <><h1>{t('account.unavailable')}</h1><p role="alert">{t('account.profileError')}</p><div className="account-actions"><button className="button button-dark" onClick={access.retry}>{t('account.retry')}</button><button className="button" onClick={() => { void access.logout().catch(() => setError(true)); }}>{t('account.signOut')}</button></div>{error && <p role="alert">{t('account.network')}</p>}</>}</AccountLayout>;
}
export function AccessGate({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const access = useAuth(), location = useLocation(), { t } = useTranslation();
  if (access.status !== 'ready') return <AccountPending />;
  if (!access.user) return <AccountRedirect to={`/login?returnTo=${encodeURIComponent(location.pathname+location.search)}`} />;
  if (!access.profile) return <AccountPending />;
  if (admin && access.profile.role !== 'admin') return <AccountLayout><h1>{t('account.denied')}</h1><p>{t('account.adminOnly')}</p><a className="button button-dark" href="/packs">{t('browseTitle')}</a></AccountLayout>;
  return children;
}

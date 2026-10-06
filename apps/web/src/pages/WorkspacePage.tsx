import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../app/useAuth';
import { AccountLayout } from '../components/AccountLayout';
export function WorkspacePage({ kind }: { kind: 'create' | 'browse' | 'admin' }) {
  const { t } = useTranslation(), access = useAuth(), [error, setError] = useState(false);
  return <AccountLayout><div className="member-bar"><div><span>{access.profile?.email}</span><strong>{t(`account.${access.profile?.role}`)}</strong></div><button onClick={() => { void access.logout().catch(() => setError(true)); }}>{t('account.signOut')}</button></div>{error && <p role="alert">{t('account.network')}</p>}<h1>{t(kind === 'create' ? 'createTitle' : kind === 'browse' ? 'browseTitle' : 'account.membersTitle')}</h1><p>{t(kind === 'create' ? 'createHint' : kind === 'browse' ? 'browseHint' : 'account.membersHint')}</p><div className="preview-status"><p>{t('account.connected')}</p><small>{t('account.workspaceNext')}</small></div><nav className="account-actions" aria-label={t('account.workspaceNav')}><Link className="button button-dark" to={kind === 'create' ? '/packs' : '/packs/new'}>{t(kind === 'create' ? 'browseTitle' : 'createTitle')} ↗</Link>{access.profile?.role === 'admin' && kind !== 'admin' && <Link className="button" to="/admin/members">{t('account.membersTitle')}</Link>}</nav></AccountLayout>;
}

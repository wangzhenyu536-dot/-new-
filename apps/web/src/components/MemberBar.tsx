import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../app/AuthProvider';
export function MemberBar() {
  const { t } = useTranslation(), access = useAuth(), [error, setError] = useState(false);
  return <><div className="member-bar"><div><span>{access.profile?.email}</span><strong>{t(`account.${access.profile?.role}`)}</strong></div><button onClick={() => { void access.logout().catch(() => setError(true)); }}>{t('account.signOut')}</button></div>{error && <p role="alert">{t('account.network')}</p>}</>;
}

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { isLocal } from '../app/firebase';
export function AccountLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return <div className="preview-page account-page"><header className="preview-header"><Link className="wordmark" to="/"><span className="wordmark-cn">EVERTRACE</span><span className="wordmark-en">®</span></Link><LanguageSwitcher /></header><main><span className="index-label">{t('account.index')}</span>{children}</main><footer className="account-footer"><Link to="/">{t('backHome')} ↗</Link>{isLocal && <span>{t('account.local')}</span>}</footer></div>;
}

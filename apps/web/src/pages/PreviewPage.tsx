import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
export function PreviewPage({ title, hint }: { title: string; hint: string }) {
  const { t } = useTranslation();
  return <div className="preview-page"><header className="preview-header"><Link className="wordmark" to="/"><span className="wordmark-cn">EVERTRACE</span><span className="wordmark-en">®</span></Link><LanguageSwitcher /></header><main><span className="index-label">{t('previewLabel')}</span><h1>{t(title)}</h1><p>{t(hint)}</p>{title !== 'notFound' && <div className="preview-status"><p>{t('nextIteration')}</p><small>{t('previewNote')}</small></div>}<Link className="button button-dark" to="/">{t('backHome')} <span>↗</span></Link></main></div>;
}

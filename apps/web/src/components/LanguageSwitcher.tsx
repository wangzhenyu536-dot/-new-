import { useTranslation } from 'react-i18next';
export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  return <div className="language-switcher" aria-label="Language / 语言">{(['en', 'zh-CN'] as const).map(language =>
    <button key={language} type="button" aria-pressed={i18n.resolvedLanguage === language} onClick={() => { localStorage.setItem('evertraceLanguage', language); void i18n.changeLanguage(language); }}>{language === 'en' ? 'EN' : '中文'}</button>
  )}</div>;
}

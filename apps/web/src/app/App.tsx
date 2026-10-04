import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HomePage } from '../pages/HomePage';
import { PreviewPage } from '../pages/PreviewPage';
export function App() {
  const { i18n } = useTranslation(); const location = useLocation();
  useEffect(() => { document.documentElement.lang = i18n.resolvedLanguage ?? 'en'; }, [i18n.resolvedLanguage]);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  return <Routes><Route path="/" element={<HomePage />} /><Route path="/packs/new" element={<PreviewPage title="createTitle" hint="createHint" />} /><Route path="/packs" element={<PreviewPage title="browseTitle" hint="browseHint" />} /><Route path="/login" element={<PreviewPage title="loginTitle" hint="accountHint" />} /><Route path="/register" element={<PreviewPage title="registerTitle" hint="accountHint" />} /><Route path="/forgot-password" element={<PreviewPage title="forgotTitle" hint="accountHint" />} /><Route path="*" element={<PreviewPage title="notFound" hint="notFoundHint" />} /></Routes>;
}

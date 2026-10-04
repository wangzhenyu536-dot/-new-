import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HomePage } from '../pages/HomePage';
import { PreviewPage } from '../pages/PreviewPage';
import { AccountPage } from '../pages/AccountPage';
import { CreatePackPage } from '../pages/CreatePackPage';
import { WorkspacePage } from '../pages/WorkspacePage';
import { AuthProvider } from './AuthProvider';
import { AccessGate } from '../components/AccessGate';
export function App() {
  const { i18n } = useTranslation(); const location = useLocation();
  useEffect(() => { document.documentElement.lang = i18n.resolvedLanguage ?? 'en'; }, [i18n.resolvedLanguage]);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  return <AuthProvider><Routes><Route path="/" element={<HomePage />} /><Route path="/packs/new" element={<AccessGate><CreatePackPage /></AccessGate>} /><Route path="/packs" element={<AccessGate><WorkspacePage kind="browse" /></AccessGate>} /><Route path="/admin/members" element={<AccessGate admin><WorkspacePage kind="admin" /></AccessGate>} /><Route path="/login" element={<AccountPage mode="login" />} /><Route path="/register" element={<AccountPage mode="register" />} /><Route path="/forgot-password" element={<AccountPage mode="reset" />} /><Route path="*" element={<PreviewPage title="notFound" hint="notFoundHint" />} /></Routes></AuthProvider>;
}

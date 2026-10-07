import { lazy } from 'react';
import { Route } from 'react-router-dom';
const PreviewPage = lazy(() => import('../pages/PreviewPage').then(module => ({ default: module.PreviewPage })));
const CreatePackPage = lazy(() => import('../pages/CreatePackPage').then(module => ({ default: module.CreatePackPage })));
const PacksPage = lazy(() => import('../pages/PacksPage').then(module => ({ default: module.PacksPage })));
const PackDetailPage = lazy(() => import('../pages/PackDetailPage').then(module => ({ default: module.PackDetailPage })));
const CategoriesPage = lazy(() => import('../pages/CategoriesPage').then(module => ({ default: module.CategoriesPage })));
const MembersPage = lazy(() => import('../pages/MembersPage').then(module => ({ default: module.MembersPage })));
import { AppFrame } from './AppFrame';
import { isSpark } from './environment';
const SparkWorkspacePage = lazy(() => import('../pages/SparkWorkspacePage').then(module => ({default:module.SparkWorkspacePage})));
const SparkCategoriesPage = lazy(() => import('../pages/SparkCategoriesPage').then(module => ({default:module.SparkCategoriesPage})));
const SparkCreatePackPage = lazy(() => import('../pages/SparkCreatePackPage').then(module => ({default:module.SparkCreatePackPage})));
const SparkPackDetailPage = lazy(() => import('../pages/SparkPackDetailPage').then(module => ({default:module.SparkPackDetailPage})));
const SparkAdminCategoriesPage = lazy(() => import('../pages/SparkAdminCategoriesPage').then(module => ({default:module.SparkAdminCategoriesPage})));
const SparkMembersPage = lazy(() => import('../pages/SparkMembersPage').then(module => ({default:module.SparkMembersPage})));
const SparkEditPackPage = lazy(() => import('../pages/SparkEditPackPage').then(module => ({default:module.SparkEditPackPage})));
import { AccessGate } from '../components/AccessGate';
export function App() {
  return <AppFrame><Route path="/packs/new" element={<AccessGate>{isSpark ? <SparkCreatePackPage /> : <CreatePackPage />}</AccessGate>} /><Route path="/packs" element={<AccessGate>{isSpark ? <SparkWorkspacePage /> : <PacksPage />}</AccessGate>} /><Route path="/packs/:id/edit" element={<AccessGate>{isSpark ? <SparkEditPackPage /> : <CreatePackPage edit />}</AccessGate>} /><Route path="/packs/:id" element={<AccessGate>{isSpark ? <SparkPackDetailPage /> : <PackDetailPage />}</AccessGate>} /><Route path="/admin/categories" element={<AccessGate admin>{isSpark ? <SparkAdminCategoriesPage /> : <CategoriesPage />}</AccessGate>} /><Route path="/admin/members" element={<AccessGate admin>{isSpark ? <SparkMembersPage /> : <MembersPage />}</AccessGate>} /><Route path="/categories" element={isSpark ? <AccessGate><SparkCategoriesPage /></AccessGate> : <PreviewPage title="notFound" hint="notFoundHint" />} /></AppFrame>;
}

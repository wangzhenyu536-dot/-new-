import {lazy} from 'react';
import {Route} from 'react-router-dom';
import {AccessGate} from '../components/AccessGate';
import {AppFrame} from './AppFrame';
const Workspace=lazy(()=>import('../pages/SparkWorkspacePage').then(m=>({default:m.SparkWorkspacePage})));
const Categories=lazy(()=>import('../pages/SparkCategoriesPage').then(m=>({default:m.SparkCategoriesPage})));
const Create=lazy(()=>import('../pages/SparkCreatePackPage').then(m=>({default:m.SparkCreatePackPage})));
const Detail=lazy(()=>import('../pages/SparkPackDetailPage').then(m=>({default:m.SparkPackDetailPage})));
const AdminCategories=lazy(()=>import('../pages/SparkAdminCategoriesPage').then(m=>({default:m.SparkAdminCategoriesPage})));
const Members=lazy(()=>import('../pages/SparkMembersPage').then(m=>({default:m.SparkMembersPage})));
const Edit=lazy(()=>import('../pages/SparkEditPackPage').then(m=>({default:m.SparkEditPackPage})));
// Same business pages and SDK contracts as the local Spark preview; only the entry is dedicated.
export function App(){return <AppFrame><Route path="/packs/new" element={<AccessGate><Create/></AccessGate>}/><Route path="/packs" element={<AccessGate><Workspace/></AccessGate>}/><Route path="/packs/:id/edit" element={<AccessGate><Edit/></AccessGate>}/><Route path="/packs/:id" element={<AccessGate><Detail/></AccessGate>}/><Route path="/admin/categories" element={<AccessGate admin><AdminCategories/></AccessGate>}/><Route path="/admin/members" element={<AccessGate admin><Members/></AccessGate>}/><Route path="/categories" element={<AccessGate><Categories/></AccessGate>}/></AppFrame>;}

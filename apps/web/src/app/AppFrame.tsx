import {lazy,Suspense,useEffect,type ReactNode} from 'react';
import {Route,Routes,useLocation} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {HomePage} from '../pages/HomePage';
import {RouteLoading} from '../components/AccountRedirect';
import {AuthProvider} from './AuthProvider';
const PreviewPage=lazy(()=>import('../pages/PreviewPage').then(m=>({default:m.PreviewPage})));
const AccountPage=lazy(()=>import('../pages/AccountPage').then(m=>({default:m.AccountPage})));
export function AppFrame({children}:{children:ReactNode}){
 const {i18n}=useTranslation(),location=useLocation();
 useEffect(()=>{document.documentElement.lang=i18n.resolvedLanguage??'en';},[i18n.resolvedLanguage]);
 useEffect(()=>{window.scrollTo(0,0);},[location.pathname]);
 return <AuthProvider><Suspense fallback={<RouteLoading/>}><Routes><Route path="/" element={<HomePage/>}/>{children}<Route path="/login" element={<AccountPage mode="login"/>}/><Route path="/register" element={<AccountPage mode="register"/>}/><Route path="/forgot-password" element={<AccountPage mode="reset"/>}/><Route path="*" element={<PreviewPage title="notFound" hint="notFoundHint"/>}/></Routes></Suspense></AuthProvider>;
}

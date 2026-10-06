import {Navigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {AccountLayout} from './AccountLayout';
export function RouteLoading(){const {t}=useTranslation();return <AccountLayout><p role="status">{t('loading')}</p></AccountLayout>;}
// Router transitions can retain the previous route while a lazy page loads.
// Keep that route visible instead of leaving only Navigate's empty output.
export function AccountRedirect({to}:{to:string}){return <><RouteLoading/><Navigate to={to} replace/></>;}

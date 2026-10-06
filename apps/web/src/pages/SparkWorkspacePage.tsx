import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AccountLayout } from '../components/AccountLayout';
import { MemberBar } from '../components/MemberBar';
import { useAuth } from '../app/useAuth';
export function SparkWorkspacePage({ upcoming = false }: {upcoming?:boolean}) {
  const {t} = useTranslation(), {profile} = useAuth();
  return <AccountLayout><MemberBar/><h1>{t(upcoming?'spark.upcomingTitle':'spark.workspaceTitle')}</h1><p>{t(upcoming?'spark.upcomingHint':'spark.workspaceHint')}</p><section className="preview-status"><strong>{profile?.displayName}</strong><p>{t('spark.available')}</p><small>{t('spark.next')}</small></section><nav className="account-actions" aria-label={t('account.workspaceNav')}><Link className="button button-dark" to="/categories">{t('spark.categoriesTitle')} <span aria-hidden="true">↗</span></Link>{upcoming&&<Link className="button" to="/packs">{t('spark.workspaceTitle')}</Link>}</nav></AccountLayout>;
}

import { useTranslation } from 'react-i18next';
import type { Issue } from '@evertrace/shared';
export function IssueList({ issues }: { issues: Issue[] }) { const { t } = useTranslation();return issues.length ? <div className="form-issues" role="alert"><ul>{issues.map((issue,index)=><li key={index}>{[issue.file,issue.sheet,issue.row&&t('form.row',{row:issue.row}),issue.column].filter(Boolean).join(' · ')}{issue.file||issue.row?': ':''}{t(`validation.${issue.code}`)}</li>)}</ul></div>:null; }

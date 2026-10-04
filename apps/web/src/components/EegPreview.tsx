import { useTranslation } from 'react-i18next';
import type { EegResult } from '@evertrace/shared';
export function EegPreview({ result }: { result: EegResult }) {
  const { t } = useTranslation(); if (!result.ok || !result.points || !result.summary) return null;
  const { points, summary } = result, span = summary.max - summary.min || 1;
  // The full series remains intact; a min/max envelope bounds SVG rendering work.
  const visible: typeof points = [];
  const step = Math.max(1, Math.ceil(points.length / 500));
  for (let i = 0; i < points.length; i += step) {
    let low = i, high = i;
    for (let j = i; j < Math.min(points.length, i + step); j++) { if (points[j].value < points[low].value) low = j; if (points[j].value > points[high].value) high = j; }
    for (const index of [...new Set([i, low, high, Math.min(points.length - 1, i + step - 1)])].sort((a, b) => a - b)) visible.push(points[index]);
  }
  const path = visible.map((point, index) => `${index ? 'L' : 'M'}${(40 + (point.time - summary.start) / (summary.end - summary.start) * 710).toFixed(2)},${(200 - (point.value - summary.min) / span * 170).toFixed(2)}`).join(' ');
  return <figure className="eeg-preview"><figcaption><strong>{t('form.preview')}</strong><span>{t('form.samples', { count: summary.count })}</span></figcaption><svg viewBox="0 0 790 245" role="img" aria-label={t('form.preview')}><line x1="40" y1="210" x2="750" y2="210" stroke="#aaa" /><path d={path} fill="none" stroke="currentColor" strokeWidth="1.4" /><text x="40" y="233">{summary.start} ms</text><text x="750" y="233" textAnchor="end">{summary.end} ms</text><text x="40" y="18">{t('form.rawValues')} · {summary.min} … {summary.max}</text></svg><p>{t('form.previewNote')}</p></figure>;
}

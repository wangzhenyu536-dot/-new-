import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Lines } from '../components/Lines';
import { useAuth } from '../app/useAuth';

export function HomePage() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const accountLabel = user ? (profile?.displayName?.trim() || profile?.email || user.displayName?.trim() || user.email || t('signIn')) : t('signIn');
  const accountPath = user ? '/packs' : '/login';
  const [intro, setIntro] = useState(() => !sessionStorage.getItem('evertraceIntroSeen') && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [progress, setProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hiddenNav, setHiddenNav] = useState(false);
  const [material, setMaterial] = useState<'text' | 'image' | 'eeg'>('text');
  const lastScroll = useRef(0);
  const finishIntro = useCallback(() => { sessionStorage.setItem('evertraceIntroSeen', '1'); setIntro(false); }, []);
  useEffect(() => { document.body.classList.toggle('is-loading', intro); return () => document.body.classList.remove('is-loading'); }, [intro]);
  useEffect(() => {
    if (!intro) return;
    const timer = setInterval(() => setProgress(previous => Math.min(100, previous + Math.max(1, Math.round((100 - previous) * .12)))), 55);
    return () => clearInterval(timer);
  }, [intro]);
  useEffect(() => { if (progress < 100) return; const timer = setTimeout(finishIntro, 420); return () => clearTimeout(timer); }, [progress, finishIntro]);
  useEffect(() => {
    const onScroll = () => { setHiddenNav(scrollY > lastScroll.current && scrollY > 220 && !menuOpen); lastScroll.current = scrollY; };
    addEventListener('scroll', onScroll, { passive: true }); return () => removeEventListener('scroll', onScroll);
  }, [menuOpen]);
  const closeMenu = () => setMenuOpen(false);
  const movePortrait = (event: PointerEvent<HTMLDivElement>) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width - .5) * -78}px`);
    event.currentTarget.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height - .5) * -38}px`);
  };
  const steps = [
    ['register', 'registerDetail', 'identity', 'none'], ['collect', 'collectDetail', 'materialsLabel', 'event'],
    ['organize', 'organizeDetail', 'category', 'decision'], ['save', 'saveDetail', 'complete', 'scene'], ['explorePack', 'exploreDetail', 'teamArchive', 'skill'],
  ];
  const rules = [['teamRule', 'teamRuleText'], ['editRule', 'editRuleText'], ['originalRule', 'originalRuleText'], ['deleteRule', 'deleteRuleText']];
  return <>
    <a className="skip-link" href="#main">{t('skip')}</a>
    {intro && <section id="loader" className="loader" aria-label={t('loading')}>
      <div className="loader-core"><div className="loader-meta"><span>{t('introMeta')}</span><span>{String(progress).padStart(3, '0')}%</span></div><div className="loader-track"><span style={{ width: `${progress}%` }} /></div></div>
      <p className="loader-intent"><Lines text={t('introIntent')} /></p><button className="loader-skip" onClick={finishIntro}>{t('skipIntro')}</button>
    </section>}
    <div id="site" className={`site ${intro ? '' : 'ready'}`} aria-hidden={intro}>
      <header className={`nav ${menuOpen ? 'open' : ''} ${hiddenNav ? 'hide-nav' : ''}`}>
        <a className="wordmark" href="#archive" onClick={closeMenu}><span className="wordmark-cn">EVERTRACE</span><span className="wordmark-en">®</span></a>
        <nav aria-label={t('navLabel')}>
          <a href="#archive" onClick={closeMenu}>{t('archive')}</a><a href="#process" onClick={closeMenu}>{t('process')}</a><a href="#signals" onClick={closeMenu}>{t('signals')}</a><a href="#privacy" onClick={closeMenu}>{t('privacy')}</a>
          <Link className="menu-cta" to="/packs" onClick={closeMenu}>{t('browse')}</Link><Link className="menu-cta account-link" to={accountPath} title={accountLabel} onClick={closeMenu}>{accountLabel}</Link><Link className="menu-cta" to="/packs/new" onClick={closeMenu}>{t('startPack')}</Link>
        </nav>
        <div className="nav-tools"><div className="nav-actions"><Link className="text-button account-link" to={accountPath} title={accountLabel}>{accountLabel}</Link><Link className="button button-small" to="/packs/new">{t('startPack')}<i /></Link></div><LanguageSwitcher /><button className="menu-button" aria-expanded={menuOpen} aria-label={t(menuOpen ? 'closeMenu' : 'openMenu')} onClick={() => setMenuOpen(!menuOpen)}><span /><span /></button></div>
      </header>
      <main id="main">
        <section id="archive" className="archive-hero section-light">
          <div className="micro-row"><span>{t('heroIndex')}</span><span>{t('explore')}</span><Link className="button button-dark home-management-entry" to="/packs">{t('managePacks')} <span aria-hidden="true">↗</span></Link></div>
          <div id="portraitStage" className="portrait-stage" aria-label={t('portraitLabel')} onPointerMove={movePortrait} onPointerLeave={event => { event.currentTarget.style.setProperty('--mx', '0px'); event.currentTarget.style.setProperty('--my', '0px'); }}>
            <img src="/assets/wisdom-portraits.png" alt={t('portraitAlt')} fetchPriority="high" />
            <div className="portrait-more" aria-hidden="true">{t('seeMore')} <span>↗</span></div>
            <button className="archive-point point-a" data-note={t('pointA')} aria-label={t('pointA')}>01</button><button className="archive-point point-b" data-note={t('pointB')} aria-label={t('pointB')}>02</button><button className="archive-point point-c" data-note={t('pointC')} aria-label={t('pointC')}>03</button>
          </div>
          <div className="hero-title-wrap"><h1><Lines text={t('heroTitle')} /></h1><p className="hero-chinese"><Lines text={t('heroDescription')} /></p></div>
          <div className="hero-footer"><p><Lines text={t('heroBoundary')} /></p><p><Lines text={t('heroFormats')} /></p><Link className="arrow-link" to="/packs/new">{t('createFirst')} <span>↘</span></Link></div>
        </section>
        <section className="statement section-dark"><div className="index-label">{t('intentIndex')}</div><h2><Lines text={t('intentTitle')} /><br /><span>{t('intentHighlight')}</span></h2><div className="statement-grid"><p>{t('intentA')}</p><p>{t('intentB')}</p></div></section>
        <section id="process" className="process section-light"><div className="section-heading"><span>{t('processIndex')}</span><h2><Lines text={t('processTitle')} /></h2></div><ol className="process-list">{steps.map(([title, detail, tag, accent], index) => <li key={title} data-accent={accent}><span>0{index + 1}</span><strong>{t(title)}</strong><p>{t(detail)}</p><i>{t(tag)}</i></li>)}</ol></section>
        <section className="materials section-dark">
          <div className="materials-copy"><span className="index-label">{t('materialsIndex')}</span><h2><Lines text={t('materialsTitle')} /></h2><p>{t('materialsDescription')}</p></div>
          <figure className="still-life"><img src="/assets/wisdom-still-life.png" alt={t('stillAlt')} loading="lazy" /><figcaption>{t('stillCaption')}</figcaption></figure>
          <div className="material-index">{(['text', 'image', 'eeg'] as const).map((kind, index) => <button key={kind} className={material === kind ? 'active' : ''} aria-pressed={material === kind} onClick={() => setMaterial(kind)}><span>0{index + 1}</span><strong>{t(`${kind}Label`)}</strong><em>{t(`${kind}Tag`)}</em></button>)}</div>
          <p className="material-note" aria-live="polite">{t(`${material}Note`)}</p>
        </section>
        <section id="signals" className="signals section-light">
          <div className="signal-heading"><span>{t('signalsIndex')}</span><h2><Lines text={t('signalsTitle')} /></h2><p>{t('signalsDescription')}</p></div>
          <div className="signal-console"><div className="signal-console-top"><span>{t('signalDesk')}</span><span>{t('templateStatus')}</span></div>
            <article className="signal-channel"><div className="signal-channel-copy"><span>{t('channel')}</span><h3>EEG</h3><p>{t('channelDescription')}</p></div><div className="signal-wave" aria-label={t('illustrative')}><svg viewBox="0 0 600 120" role="img"><path d="M0 62L26 60L45 67L60 28L75 91L95 57L130 62L158 59L175 66L188 36L203 84L220 62L254 60L276 64L292 20L308 99L324 55L360 61L389 58L406 70L421 41L439 79L458 61L493 60L520 65L538 31L552 91L570 58L600 62" /></svg><small>{t('illustrative')}</small></div><div className="signal-upload"><span>{t('fileType')}</span><Link to="/packs/new">{t('prepareExcel')}</Link></div></article>
            <article className="signal-channel"><div className="signal-channel-copy"><span>{t('template')}</span><h3>{t('formatTitle')}</h3><p>{t('formatDescription')}</p></div><div className="format-preview"><div><span>timestamp_ms</span><span>value</span></div><div><span>0</span><span>427</span></div><div><span>2</span><span>421</span></div><small>{t('templatePreview')}</small></div><div className="signal-upload"><span>{t('required')}</span><Link to="/packs/new">{t('newPack')}</Link></div></article>
            <div className="signal-metrics">{[['metricFiles', 'metricRequired'], ['metricImage', 'metricOptional'], ['metricAnalysis', 'metricOriginal'], ['metricDownload', 'metricZip']].map(([label, value]) => <div key={label}><span>{t(label)}</span><strong>{t(value)}</strong></div>)}</div><p className="signal-boundary"><strong>{t('signalNoteLabel')}</strong>{t('signalNote')}</p>
          </div>
        </section>
        <section id="privacy" className="privacy section-light"><div className="privacy-title"><span>{t('privacyIndex')}</span><h2><Lines text={t('privacyTitle')} /></h2></div><div className="privacy-rules">{rules.map(([title, detail], index) => <article key={title}><span>0{index + 1}</span><h3>{t(title)}</h3><p>{t(detail)}</p></article>)}</div></section>
        <section id="studio" className="studio section-dark"><div className="studio-header"><div><span>{t('studioIndex')}</span><h2><Lines text={t('studioTitle')} /></h2></div><div className="studio-status"><i /><span>{t('studioStatus')}</span></div></div><div className="studio-start"><p className="workspace-description">{t('studioDescription')}</p><div className="studio-controls"><div className="consent-inline"><span>{t('studioHint')}</span><span>{t('studioShare')}</span><span>{t('studioNoDraft')}</span></div><div className="workspace-actions"><Link className="button button-light" to="/packs/new">{t('startPack')} <span>↗</span></Link><Link className="button button-package" to="/packs">{t('browse')} <span>↗</span></Link></div></div></div></section>
        <section className="finale section-light"><div className="finale-line"><span>{t('finaleMeta')}</span><span>{t('finaleArchive')}</span><span>08 / 08</span></div><h2><Lines text={t('finaleTitle')} /></h2><Link className="button button-dark" to="/packs/new">{t('createFirst')}<i /></Link></section>
      </main>
      <footer><a className="wordmark footer-wordmark" href="#archive"><span className="wordmark-cn">EVERTRACE</span><span className="wordmark-en">®</span></a><p><Lines text={t('footerNote')} /></p><div><a href="#process">{t('process')}</a><Link to="/packs">{t('browse')}</Link><Link to="/register">{t('register')}</Link></div></footer>
    </div>
  </>;
}

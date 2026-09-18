import { useEffect } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  FileText,
  Github,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { FeatureSection } from "./components/FeatureSection";
import { DownloadSection } from "./components/DownloadSection";
import { getDownloadCopy } from "./content/downloads";
import { Brand, SiteHeader } from "./components/SiteHeader";
import { WorkspacePreview } from "./components/WorkspacePreview";
import { HeroTidalBackground } from "./components/hero-background/HeroTidalBackground";
import { getLandingCopy } from "./content";
import { resolveAppUrl, SOURCE_URL } from "./lib/app-url";

export default function App() {
  const { effectiveLanguage } = useLanguage();
  const copy = getLandingCopy(effectiveLanguage);
  const downloadCopy = getDownloadCopy(effectiveLanguage);
  const appUrl = resolveAppUrl(import.meta.env.VITE_APP_URL, window.location);

  useEffect(() => {
    const title = `Legir — ${copy.hero.title} ${copy.hero.accent}`;
    document.title = title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", copy.hero.description);
    document
      .querySelector('meta[property="og:title"]')
      ?.setAttribute("content", title);
    document
      .querySelector('meta[property="og:description"]')
      ?.setAttribute("content", copy.hero.description);
  }, [copy]);

  return (
    <div className="landing" id="top">
      <a className="skip-link" href="#main-content">
        {copy.nav.skip}
      </a>
      <SiteHeader
        copy={copy}
        appUrl={appUrl}
        downloadLabel={downloadCopy.nav}
      />
      <main id="main-content" tabIndex={-1}>
        <div className="hero-scene">
          <HeroTidalBackground />
          <section className="hero site-container" aria-labelledby="hero-title">
            <p className="eyebrow hero-eyebrow">
              <span className="status-dot" />
              {copy.hero.eyebrow}
            </p>
            <h1 id="hero-title">
              {copy.hero.title}
              <span>{copy.hero.accent}</span>
            </h1>
            <p className="hero-description">{copy.hero.description}</p>
            <div className="hero-actions">
              <a className="site-button" href={appUrl}>
                {copy.hero.cta}
                <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className="site-button button-secondary" href="#downloads">
                <Download size={18} aria-hidden="true" />
                {downloadCopy.cta}
              </a>
            </div>
            <p className="hero-note">{copy.hero.note}</p>
          </section>
        </div>

        <WorkspacePreview copy={copy.preview} language={effectiveLanguage} />
        <FeatureSection copy={copy.features} />

        <section
          className="privacy-section site-container"
          aria-labelledby="privacy-title"
        >
          <div className="privacy-visual" aria-hidden="true">
            <div className="privacy-orbit orbit-outer" />
            <div className="privacy-orbit orbit-inner" />
            <div className="local-document">
              <div className="local-document-top">
                <FileText size={21} />
                <span>.pdf</span>
              </div>
              <i />
              <i />
              <i />
              <div className="document-lock">
                <LockKeyhole size={28} strokeWidth={1.5} />
              </div>
              <div className="document-check">
                <Check size={15} />
              </div>
            </div>
            <div className="privacy-label">
              <span className="status-dot" />
              {copy.privacy.badge}
            </div>
            <span className="orbit-dot dot-one" />
            <span className="orbit-dot dot-two" />
          </div>
          <div className="privacy-copy">
            <p className="eyebrow">{copy.privacy.eyebrow}</p>
            <h2 id="privacy-title">{copy.privacy.title}</h2>
            <p>{copy.privacy.description}</p>
            <div className="privacy-detail">
              <ShieldCheck size={19} aria-hidden="true" />
              <p>{copy.privacy.detail}</p>
            </div>
          </div>
        </section>

        <section
          className="workflow-section site-container section-space"
          id="workflow"
          aria-labelledby="workflow-title"
        >
          <p className="eyebrow">{copy.workflow.eyebrow}</p>
          <h2 id="workflow-title">{copy.workflow.title}</h2>
          <ol className="workflow-steps">
            {copy.workflow.steps.map((step, index) => (
              <li key={step.title}>
                <span className="step-number">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <DownloadSection copy={downloadCopy} />

        <section
          className="faq-section site-container"
          id="faq"
          aria-labelledby="faq-title"
        >
          <div>
            <p className="eyebrow">FAQ</p>
            <h2 id="faq-title">{copy.faq.title}</h2>
          </div>
          <div className="faq-list">
            {copy.faq.items.map((item) => (
              <details key={item.title} name="landing-faq">
                <summary>
                  {item.title}
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <p>{item.description}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          className="closing-section site-container"
          aria-labelledby="closing-title"
        >
          <img
            src="/icons/app-icon.svg"
            width="44"
            height="44"
            alt=""
            loading="lazy"
          />
          <h2 id="closing-title">{copy.closing.title}</h2>
          <p>{copy.closing.description}</p>
          <a className="site-button" href={appUrl}>
            {copy.hero.cta}
            <ArrowRight size={18} aria-hidden="true" />
          </a>
        </section>
      </main>
      <footer className="site-footer site-container">
        <div>
          <Brand label={copy.nav.home} />
          <p>{copy.footer.tagline}</p>
        </div>
        <div className="footer-meta">
          <a href="#downloads">{downloadCopy.nav}</a>
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            <Github size={15} aria-hidden="true" />
            GitHub
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
          <a
            href={`${SOURCE_URL}/blob/main/LICENSE`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.footer.license}
          </a>
          <span>© {new Date().getFullYear()} Legir</span>
        </div>
      </footer>
    </div>
  );
}

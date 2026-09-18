import { useRef, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { LanguageDropdownToggle } from "@/components/LanguageToggle";
import { ThemeDropdownToggle } from "@/components/ThemeToggle";
import type { LandingCopy } from "../content/types";

export function Brand({ label }: { label: string }) {
  return (
    <a className="site-brand" href="#top" aria-label={label}>
      <img src="/icons/app-icon.svg" alt="" width="34" height="34" />
      <span>{process.env.APP_NAME ?? "Legir"}</span>
    </a>
  );
}

export function SiteHeader({
  copy,
  appUrl,
  downloadLabel,
}: {
  copy: LandingCopy;
  appUrl: string;
  downloadLabel: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const links = [
    { href: "#features", label: copy.nav.features },
    { href: "#workflow", label: copy.nav.workflow },
    { href: "#downloads", label: downloadLabel },
    { href: "#faq", label: copy.nav.faq },
  ];

  return (
    <header
      className="site-header"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <div className="site-container header-inner">
        <Brand label={copy.nav.home} />
        <nav className="desktop-navigation" aria-label={copy.nav.menu}>
          {links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <LanguageDropdownToggle />
          <ThemeDropdownToggle />
          <a className="site-button button-small header-cta" href={appUrl}>
            {copy.hero.cta}
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
          <button
            ref={menuButton}
            type="button"
            className="mobile-menu-toggle"
            aria-label={menuOpen ? copy.nav.close : copy.nav.menu}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
      <nav
        id="mobile-navigation"
        className="mobile-navigation"
        hidden={!menuOpen}
        aria-label={copy.nav.menu}
      >
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={() => setMenuOpen(false)}
          >
            {link.label}
          </a>
        ))}
        <a href={appUrl} onClick={() => setMenuOpen(false)}>
          {copy.hero.cta}
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </nav>
    </header>
  );
}

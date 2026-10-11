import { useRef, useState } from "react";
import { Github, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageDropdownToggle } from "@/components/LanguageToggle";
import { ThemeDropdownToggle } from "@/components/ThemeToggle";
import type { LandingCopy } from "../content/types";
import { SOURCE_URL } from "../lib/app-url";

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
  downloadLabel,
}: {
  copy: LandingCopy;
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
          <Button asChild variant="ghost" size="icon">
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={copy.hero.source}
              title={copy.hero.source}
            >
              <Github className="size-[1.2rem]" aria-hidden="true" />
            </a>
          </Button>
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
      </nav>
    </header>
  );
}

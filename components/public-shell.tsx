import Link from "next/link";
import { publicDemoEnabled } from "@/lib/public-demo-config";
import { publicArchiveEnabled } from "@/lib/public-surface";
import { Icons } from "./icons";

function PublicLinks({ active, className, demoMode, label }: { active?: string; className: string; demoMode: boolean; label: string }) {
  const links = demoMode ? [
    { href: "/", label: "Demo home" },
    { href: "/family", label: "Family archive" },
    { href: "/people", label: "People" },
    { href: "/places", label: "Places" },
    { href: "/stories", label: "Stories" }
  ] : [
    { href: "/", label: "Public Archive" },
    { href: "/people", label: "People" },
    { href: "/places", label: "Places" },
    { href: "/stories", label: "Stories" },
    { href: "/kinsleuth", label: "Product" }
  ];
  return (
    <nav className={className} aria-label={label}>
      {links.map((link) => (
        <Link aria-current={active === link.href ? "page" : undefined} className={active === link.href ? "active" : undefined} href={link.href} key={link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function PublicShell({ children, active, tagline }: { children: React.ReactNode; active?: string; tagline?: string }) {
  const archiveAvailable = publicArchiveEnabled();
  const demoMode = publicDemoEnabled();
  const homeHref = archiveAvailable ? "/" : "/login";

  return (
    <div className="public-shell">
      <header className="public-header">
        <div className="public-nav">
          <Link className="brand" href={homeHref}>
            <span className="brand-mark">
              <Icons.TreePine size={22} aria-hidden />
            </span>
            <span>
              Kin Resolve
              <small>{archiveAvailable ? tagline || "Family history. Openly shared." : "Private family research workspace."}</small>
            </span>
          </Link>
          {archiveAvailable ? <PublicLinks active={active} className="nav-links" demoMode={demoMode} label="Public navigation" /> : null}
          <Link className="button-secondary public-workspace-link" href={demoMode ? "/" : "/login"}>
            {demoMode ? <Icons.Home size={16} aria-hidden /> : <Icons.Lock size={16} aria-hidden />}
            {demoMode ? "Start demo" : "Private workspace"}
          </Link>
          {archiveAvailable ? <details className="mobile-menu public-mobile-menu">
            <summary>
              <Icons.Menu size={19} aria-hidden />
              Menu
            </summary>
            <div className="mobile-menu-panel">
              <PublicLinks active={active} className="mobile-menu-links" demoMode={demoMode} label="Mobile public navigation" />
              <Link className="button-secondary" href={demoMode ? "/" : "/login"}>
                {demoMode ? <Icons.Home size={16} aria-hidden /> : <Icons.Lock size={16} aria-hidden />}
                {demoMode ? "Start demo" : "Private workspace"}
              </Link>
            </div>
          </details> : null}
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>{children}</main>
      <footer className="public-footer">
        <div className="footer-inner">
          <Link className="brand" href={homeHref}>
            <span className="brand-mark">
              <Icons.TreePine size={18} aria-hidden />
            </span>
            <span>Kin Resolve</span>
          </Link>
          <span>
            {archiveAvailable
              ? demoMode
                ? "Fictional public demo · workspaces expire after 24 hours · AGPL-3.0-only source."
                : "AGPL-3.0-only self-hosted genealogy investigation software."
              : "Invitation-only hosted beta · AGPL-3.0-only source available."}
          </span>
        </div>
      </footer>
    </div>
  );
}

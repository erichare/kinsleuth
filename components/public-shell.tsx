import Link from "next/link";
import { publicArchiveEnabled } from "@/lib/public-surface";
import { Icons } from "./icons";

const links = [
  { href: "/", label: "Public Archive" },
  { href: "/people", label: "People" },
  { href: "/places", label: "Places" },
  { href: "/stories", label: "Stories" },
  { href: "/kinsleuth", label: "Product" }
];

function PublicLinks({ active, className, label }: { active?: string; className: string; label: string }) {
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
          {archiveAvailable ? <PublicLinks active={active} className="nav-links" label="Public navigation" /> : null}
          <Link className="button-secondary public-workspace-link" href="/login">
            <Icons.Lock size={16} aria-hidden />
            Private workspace
          </Link>
          {archiveAvailable ? <details className="mobile-menu public-mobile-menu">
            <summary>
              <Icons.Menu size={19} aria-hidden />
              Menu
            </summary>
            <div className="mobile-menu-panel">
              <PublicLinks active={active} className="mobile-menu-links" label="Mobile public navigation" />
              <Link className="button-secondary" href="/login">
                <Icons.Lock size={16} aria-hidden />
                Private workspace
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
              ? "AGPL-3.0-only self-hosted genealogy investigation software."
              : "Invitation-only hosted beta · AGPL-3.0-only source available."}
          </span>
        </div>
      </footer>
    </div>
  );
}

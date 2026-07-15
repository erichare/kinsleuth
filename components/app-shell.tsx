import Link from "next/link";
import { Icons } from "./icons";

const navGroups = [
  {
    label: "Research",
    items: [
      { href: "/app", label: "Dashboard", icon: Icons.Home },
      { href: "/app/cases", label: "Cases", icon: Icons.FileSearch },
      { href: "/app/people", label: "People", icon: Icons.Users },
      { href: "/app/dna", label: "DNA Matches", icon: Icons.Dna }
    ]
  },
  {
    label: "Archive",
    items: [
      { href: "/app/sources", label: "Sources", icon: Icons.Database },
      { href: "/app/imports", label: "Data sources", icon: Icons.Upload }
    ]
  },
  {
    label: "Intelligence",
    items: [
      { href: "/app/ai", label: "AI Analyst", icon: Icons.Brain },
      { href: "/app/reports", label: "Reports", icon: Icons.BookOpen },
      { href: "/app/publishing", label: "Publishing", icon: Icons.Shield }
    ]
  },
  {
    label: "System",
    items: [{ href: "/app/settings", label: "Settings", icon: Icons.Settings }]
  }
];

function PrivateNavigation({ active, className, label }: { active: string; className: string; label: string }) {
  return (
    <nav className={className} aria-label={label}>
      {navGroups.map((group) => (
        <div className="sidebar-nav-group" key={group.label}>
          <span className="sidebar-nav-label">{group.label}</span>
          {group.items.map((item) => {
            const Icon = item.icon;
            return (
              <Link aria-current={active === item.href ? "page" : undefined} className={active === item.href ? "active" : undefined} href={item.href} key={item.href}>
                <Icon size={16} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function ArchiveCard({ archiveName }: { archiveName: string }) {
  return (
    <div className="sidebar-archive-card" aria-label="Active archive">
      <Icons.Database size={17} aria-hidden />
      <span>
        <small>Active archive</small>
        {archiveName}
      </span>
    </div>
  );
}

export function AppShell({
  children,
  active = "/app",
  title,
  actions,
  archiveName = "Private archive"
}: {
  children: React.ReactNode;
  active?: string;
  title: string;
  actions?: React.ReactNode;
  archiveName?: string;
}) {
  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <Link className="brand" href="/app">
          <span className="brand-mark">
            <Icons.TreePine size={22} aria-hidden />
          </span>
          <span>
            Kin Resolve
            <small>Private research</small>
          </span>
        </Link>
        <PrivateNavigation active={active} className="sidebar-nav" label="Private navigation" />
        <ArchiveCard archiveName={archiveName} />
        <form action="/api/auth/logout" className="sidebar-auth" method="post">
          <button type="submit">Sign out</button>
        </form>
      </aside>
      <header className="app-mobile-header">
        <Link className="brand" href="/app">
          <span className="brand-mark"><Icons.TreePine size={20} aria-hidden /></span>
          <span>Kin Resolve<small>Private research</small></span>
        </Link>
        <details className="mobile-menu private-mobile-menu">
          <summary><Icons.Menu size={19} aria-hidden />Menu</summary>
          <div className="mobile-menu-panel">
            <PrivateNavigation active={active} className="mobile-menu-links private-mobile-links" label="Mobile private navigation" />
            <ArchiveCard archiveName={archiveName} />
            <form action="/api/auth/logout" className="sidebar-auth" method="post">
              <button type="submit">Sign out</button>
            </form>
          </div>
        </details>
      </header>
      <main className="app-main" id="main-content" tabIndex={-1}>
        <div className="app-topbar">
          <div>
            <h1>{title}</h1>
            <div className="muted">{archiveName}</div>
          </div>
          {actions ? <div className="app-topbar-actions">{actions}</div> : null}
        </div>
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}

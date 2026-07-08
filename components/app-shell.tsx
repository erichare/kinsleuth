import Link from "next/link";
import { Icons } from "./icons";

const nav = [
  { href: "/app", label: "Dashboard", icon: Icons.Home },
  { href: "/app/cases", label: "Cases", icon: Icons.FileSearch },
  { href: "/app/people", label: "People", icon: Icons.Users },
  { href: "/app/dna", label: "DNA Matches", icon: Icons.Dna },
  { href: "/app/sources", label: "Sources", icon: Icons.Database },
  { href: "/app/imports", label: "GEDCOM Imports", icon: Icons.Upload },
  { href: "/app/ai", label: "AI Analyst", icon: Icons.Brain },
  { href: "/app/reports", label: "Reports", icon: Icons.BookOpen },
  { href: "/app/publishing", label: "Publishing", icon: Icons.Shield },
  { href: "/app/settings", label: "Settings", icon: Icons.Settings }
];

export function AppShell({ children, active = "/app", title, actions }: { children: React.ReactNode; active?: string; title: string; actions?: React.ReactNode }) {
  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <Link className="brand" href="/app">
          <span className="brand-mark">
            <Icons.TreePine size={22} aria-hidden />
          </span>
          <span>
            KinSleuth
            <small>Private research</small>
          </span>
        </Link>
        <nav className="sidebar-nav" aria-label="Private navigation">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Link className={active === item.href ? "active" : undefined} href={item.href} key={item.href}>
                <Icon size={16} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="app-main">
        <div className="app-topbar">
          <div>
            <h1>{title}</h1>
            <div className="muted">Riemer - Zajicek Archive</div>
          </div>
          <div>{actions}</div>
        </div>
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}

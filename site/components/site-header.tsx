import Link from "next/link";
import { Brand } from "@/components/brand";
import { navigation, site } from "@/lib/site";

function NavigationLinks({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav className={mobile ? "mobile-nav-links" : "desktop-nav"} aria-label={mobile ? "Mobile navigation" : "Main navigation"}>
      <a href={site.demoUrl}>Demo</a>
      {navigation.map((item) => (
        <Link href={item.href} key={item.href}>
          {item.label}
        </Link>
      ))}
      {mobile && (
        <>
          <a href={site.github}>View on GitHub</a>
          <Link className="button button-small" href="/beta">Apply for the private beta</Link>
        </>
      )}
    </nav>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Brand />
        <NavigationLinks />
        <div className="header-actions">
          <a className="text-link" href={site.github}>GitHub <span aria-hidden="true">↗</span></a>
          <Link className="button button-small" href="/beta">Apply for the private beta</Link>
        </div>
        <details className="mobile-menu">
          <summary aria-label="Open navigation">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </summary>
          <NavigationLinks mobile />
        </details>
      </div>
    </header>
  );
}

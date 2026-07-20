import Link from "next/link";
import { Brand } from "@/components/brand";
import { navigation, site } from "@/lib/site";

function DesktopNavigation() {
  return (
    <nav className="desktop-nav" aria-label="Main navigation">
      <a href={site.demoUrl}>Demo</a>
      {navigation.slice(0, 3).map((item) => (
        <Link href={item.href} key={item.href}>
          {item.label}
        </Link>
      ))}
      <details className="desktop-nav-more">
        <summary>More <span aria-hidden="true">⌄</span></summary>
        <div aria-label="More links" className="desktop-nav-more-menu" role="group">
          {navigation.slice(3).map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
          <a href={site.github}>GitHub <span aria-hidden="true">↗</span></a>
        </div>
      </details>
    </nav>
  );
}

function MobileNavigation() {
  return (
    <nav className="mobile-nav-links" aria-label="Mobile navigation">
      <a href={site.demoUrl}>Demo</a>
      {navigation.map((item) => (
        <Link href={item.href} key={item.href}>
          {item.label}
        </Link>
      ))}
      <a href={site.github}>View on GitHub</a>
      <Link className="button button-small" href="/beta">Apply for the private beta</Link>
    </nav>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Brand />
        <DesktopNavigation />
        <div className="header-actions">
          <Link className="button button-small" href="/beta">Apply for the private beta</Link>
        </div>
        <details className="mobile-menu">
          <summary aria-label="Open navigation">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </summary>
          <MobileNavigation />
        </details>
      </div>
    </header>
  );
}

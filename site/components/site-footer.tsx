import Link from "next/link";
import { Brand } from "@/components/brand";
import { betaStatus } from "@/lib/beta-status";
import { navigation, site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-intro">
          <Brand footer />
          <p>Built for the work between a clue and a conclusion.</p>
          <span
            className="status-chip"
            data-beta-status-surface="footer"
            data-marketing-release-mode={betaStatus.releaseMode}
          ><i aria-hidden="true" /> {betaStatus.summary}</span>
        </div>
        <div>
          <h2>Explore</h2>
          <nav aria-label="Footer navigation">
            <a href={site.demoUrl}>Try the demo</a>
            {navigation.slice(0, 3).map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
          </nav>
        </div>
        <div>
          <h2>Project</h2>
          <nav aria-label="Project links">
            {navigation.slice(3).map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
            <a href={site.github}>GitHub <span aria-hidden="true">↗</span></a>
          </nav>
        </div>
        <div>
          <h2>Get involved</h2>
          <nav aria-label="Participation links">
            <Link href="/beta">Apply for the private beta</Link>
            <Link href="/privacy">Data practices</Link>
          </nav>
        </div>
      </div>
      <div className="shell footer-bottom">
        <span>© {new Date().getFullYear()} Kin Resolve</span>
        <a href={site.sourceUrl}>
          Source for this build <code>{site.sourceCommit.slice(0, 12)}</code> · AGPL-3.0-only
        </a>
      </div>
    </footer>
  );
}

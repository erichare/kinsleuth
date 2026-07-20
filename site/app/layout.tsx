import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { marketingAnalyticsMode } from "@/lib/analytics";
import { site } from "@/lib/site";
import "./globals.css";

const manrope = localFont({
  src: "./fonts/manrope-latin-variable.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  variable: "--font-sans",
  fallback: ["Arial"],
  adjustFontFallback: "Arial"
});

const newsreader = localFont({
  src: "./fonts/newsreader-latin-variable.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  variable: "--font-serif",
  fallback: ["Times New Roman"],
  adjustFontFallback: "Times New Roman"
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: "Kin Resolve — Evidence-led genealogy research",
    template: "%s — Kin Resolve"
  },
  description: site.description,
  applicationName: site.name,
  manifest: "/manifest.webmanifest",
  category: "genealogy research software",
  keywords: ["genealogy", "family history", "genealogy research", "GEDCOM", "DNA matches", "source citations"],
  alternates: {
    canonical: "/"
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: site.name,
    title: "Kin Resolve — Evidence-led genealogy research",
    description: site.description,
    url: site.url,
    images: [{
      url: "/og.png",
      width: 1200,
      height: 630,
      alt: "Kin Resolve — evidence-led genealogy research"
    }]
  },
  twitter: {
    card: "summary_large_image",
    title: "Kin Resolve — Evidence-led genealogy research",
    description: site.description,
    images: ["/og.png"]
  }
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#173f35"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${newsreader.variable}`}>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
        {marketingAnalyticsMode === "plausible" ? (
          <script data-domain="kinresolve.com" defer src="https://plausible.io/js/script.outbound-links.js" />
        ) : null}
      </body>
    </html>
  );
}

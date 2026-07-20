import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import { publicDemoAnalyticsScriptEnabled } from "@/lib/public-demo-analytics";
import { publicArchiveEnabled } from "@/lib/public-surface";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter"
});

const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-newsreader"
});

export function generateMetadata(): Metadata {
  const privateDeployment = !publicArchiveEnabled();
  return {
    title: "Kin Resolve",
    description: privateDeployment
      ? "Private genealogy research workspace"
      : "Self-hosted genealogy research workspace",
    ...(privateDeployment ? {
      robots: {
        index: false,
        follow: false,
        noarchive: true
      }
    } : {})
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${newsreader.variable}`}>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
        {publicDemoAnalyticsScriptEnabled() ? (
          <script data-domain="demo.kinresolve.com" defer src="https://plausible.io/js/script.js" />
        ) : null}
      </body>
    </html>
  );
}

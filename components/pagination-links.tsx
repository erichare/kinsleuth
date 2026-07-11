import Link from "next/link";
import type React from "react";
import { Icons } from "@/components/icons";
import type { SearchParamValue } from "@/lib/pagination";

type Props = {
  ariaLabel: string;
  page: number;
  pageCount: number;
  pageParam: string;
  pathname: string;
  searchParams: Record<string, SearchParamValue>;
};

export function PaginationLinks({ ariaLabel, page, pageCount, pageParam, pathname, searchParams }: Props) {
  return (
    <nav className="pagination-controls" aria-label={ariaLabel}>
      <PageLink ariaLabel="Previous page" disabled={page <= 1} href={buildHref(pathname, searchParams, pageParam, page - 1)}>
        <Icons.ChevronLeft size={16} aria-hidden />
      </PageLink>
      <span aria-current="page" aria-label={`Page ${page.toLocaleString()} of ${pageCount.toLocaleString()}`} className="tag">
        {page.toLocaleString()} <span className="pagination-count">/ {pageCount.toLocaleString()}</span>
      </span>
      <PageLink ariaLabel="Next page" disabled={page >= pageCount} href={buildHref(pathname, searchParams, pageParam, page + 1)}>
        <Icons.ChevronRight size={16} aria-hidden />
      </PageLink>
    </nav>
  );
}

function PageLink({ ariaLabel, children, disabled, href }: { ariaLabel: string; children: React.ReactNode; disabled: boolean; href: string }) {
  if (disabled) {
    return (
      <span aria-disabled="true" aria-label={ariaLabel} className="button-secondary icon-button pagination-disabled" role="link">
        {children}
      </span>
    );
  }

  return (
    <Link aria-label={ariaLabel} className="button-secondary icon-button" href={href}>
      {children}
    </Link>
  );
}

function buildHref(pathname: string, searchParams: Record<string, SearchParamValue>, pageParam: string, page: number): string {
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === pageParam || value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        nextParams.append(key, item);
      }
      continue;
    }

    nextParams.set(key, value);
  }

  if (page > 1) {
    nextParams.set(pageParam, String(page));
  }

  const query = nextParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

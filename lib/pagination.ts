export type PaginationInput = {
  page: number;
  pageSize: number;
};

export type PaginationResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
};

export type SearchParamValue = string | string[] | null | undefined;

export const maximumPageSize = 500;

export function paginateItems<T>(items: T[], input: PaginationInput, maxPageSize = maximumPageSize): PaginationResult<T> {
  const pageSize = clampInteger(input.pageSize, 1, maxPageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = clampInteger(input.page, 1, pageCount);
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);

  return {
    items: pageItems,
    page,
    pageSize,
    pageCount,
    total: items.length,
    start: pageItems.length === 0 ? 0 : startIndex + 1,
    end: startIndex + pageItems.length
  };
}

export function parsePositiveInteger(value: SearchParamValue, fallback: number): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.trunc(parsed);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

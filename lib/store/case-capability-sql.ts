export function dnaResearchCaseSql(prefix: string): string {
  return `lower(btrim(concat_ws(' ', ${prefix}id, ${prefix}title, ${prefix}question, ${prefix}focus))) ~ '(^|[^a-z0-9])dna([^a-z0-9]|$)'`;
}

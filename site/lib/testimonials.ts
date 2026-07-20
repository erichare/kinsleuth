/**
 * Tester quotes for the home social-proof strip.
 *
 * Ships empty on purpose: the strip renders only when the public demo is live
 * AND this array has entries, so real quotes land as a data-only change with
 * no page edits. Every entry must be a real, permissioned quote from a named
 * tester—never invented, and never attributed to the fictional
 * Hartwell–Mercer universe.
 */
export interface Testimonial {
  /** The quote itself, without surrounding quotation marks. */
  quote: string;
  /** Who said it, as they agreed to be credited. */
  attribution: string;
  /** Optional short context, e.g. what they were researching. */
  context?: string;
}

export const testimonials: readonly Testimonial[] = [];

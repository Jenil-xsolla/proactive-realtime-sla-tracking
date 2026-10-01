import { timingSafeEqual } from "node:crypto";

/**
 * Timing-safe shared-secret comparison, shared by every internal/webhook
 * route that checks a header against an env var (spec §8.3: "checked in the
 * route itself, not VPN placement alone"). Placement here, rather than in
 * either route, is what makes both routes use the same check.
 *
 * Returns false when `expected` is missing or empty, or when `provided` is
 * null, without ever calling `timingSafeEqual` on mismatched lengths (which
 * throws) — a length mismatch is rejected first.
 */
export function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!expected || provided === null) {
    return false;
  }
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, providedBytes);
}

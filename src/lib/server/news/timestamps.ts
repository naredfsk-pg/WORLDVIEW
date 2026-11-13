/**
 * `parseFeedTimestamp` (ARCHITECTURE §7). The contract places it in `utils/date.ts`; it lives here
 * until that lane adds it. Pure: `now` is injected.
 */

/** Feed clocks drift; anything further in the future than this is treated as bogus. */
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1000;

/** ISO 8601 with a mandatory `Z` or `±HH:MM` offset. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;

/** RFC 822 / 2822 with a 4-digit year and a mandatory zone (numeric or a common name). */
const RFC_822_WITH_ZONE =
	/^(?:[A-Za-z]{3},\s*)?\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(?:[+-]\d{4}|GMT|UTC?|Z|[ECMP][SD]T)$/i;

/**
 * UTC ISO string for an RFC 822 or ISO 8601 feed timestamp. Returns null when the input is
 * missing, unparseable, has no zone (a guess would use host-local time), or is more than 1 h
 * after `now`. Never guesses.
 */
export function parseFeedTimestamp(raw: string | null | undefined, now: Date): string | null {
	if (!raw) return null;
	const value = raw.trim();
	if (value.length > 64) return null;
	if (!ISO_WITH_ZONE.test(value) && !RFC_822_WITH_ZONE.test(value)) return null;

	const ms = Date.parse(value);
	if (Number.isNaN(ms)) return null;
	if (ms > now.getTime() + MAX_FUTURE_SKEW_MS) return null;
	return new Date(ms).toISOString();
}

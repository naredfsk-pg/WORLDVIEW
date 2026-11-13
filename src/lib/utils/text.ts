/**
 * Text normalization for model output (pure, isomorphic). Used by the LLM output schemas, so
 * every generated text is stored in this form, and by the editorial G3 checks.
 */

/** Format characters: zero-width (space, joiners, word joiner), bidi controls, soft hyphen, BOM. */
const FORMAT_CHARS = /\p{Cf}/gu;
/** NFKC splits THAI SARA AM (U+0E33) into NIKHAHIT + SARA AA; this pair is put back together. */
const SPLIT_SARA_AM = /\u{0E4D}\u{0E32}/gu;

/**
 * The form every generated text is checked and stored in: format characters removed, then NFKC
 * (fullwidth letters and dots become ASCII) with Thai SARA AM kept as one character, so search
 * and display still match what people type.
 */
export function normalizeGeneratedText(value: string): string {
	return value.replace(FORMAT_CHARS, '').normalize('NFKC').replace(SPLIT_SARA_AM, '\u{0E33}');
}

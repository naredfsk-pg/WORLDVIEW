/** Defensive JSON extraction from model text: strip code fences, take the outermost `{…}`. */

export type JsonExtraction = { ok: true; value: unknown } | { ok: false; reason: string };

export function extractJsonObject(content: string): JsonExtraction {
	const unfenced = content.replace(/```(?:json)?/gi, '');
	const start = unfenced.indexOf('{');
	const end = unfenced.lastIndexOf('}');
	if (start === -1 || end <= start) return { ok: false, reason: 'no JSON object found in output' };

	try {
		return { ok: true, value: JSON.parse(unfenced.slice(start, end + 1)) };
	} catch {
		return { ok: false, reason: 'output is not valid JSON' };
	}
}

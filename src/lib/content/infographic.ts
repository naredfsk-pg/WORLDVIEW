/**
 * Lesson infographic specs (ARCHITECTURE §13): typed data in the lesson frontmatter, rendered as
 * HTML/CSS layouts with small decorative SVG shapes by `components/infographic`. All text is plain
 * text (Svelte escapes it), so a spec can never inject markup.
 *
 * Length limits keep every box readable at 320 px: they count UTF-16 code units, and Thai vowel and
 * tone marks count as characters, so the visible length is shorter than the limit.
 */
import { z } from 'zod';
import type { Infographic, InfographicNode } from '../types/domain';

export const INFOGRAPHIC_TYPES = [
	'flow',
	'cycle',
	'timeline',
	'compare',
	'hub',
	'stats',
	'layers'
] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const label = text(60);
const detail = text(160).optional();

const node = z.strictObject({ label, detail });

/** Shared by every infographic type. `summary` is the caption and the accessible description. */
const base = {
	title: text(80),
	summary: text(200),
	source: text(160).optional()
};

const flowSchema = z.strictObject({
	...base,
	type: z.literal('flow'),
	steps: z.array(node).min(2).max(6)
});

const cycleSchema = z.strictObject({
	...base,
	type: z.literal('cycle'),
	steps: z.array(node).min(3).max(6)
});

const timelineSchema = z.strictObject({
	...base,
	type: z.literal('timeline'),
	events: z
		.array(z.strictObject({ date: text(24), label, detail }))
		.min(3)
		.max(8)
});

const compareSchema = z.strictObject({
	...base,
	type: z.literal('compare'),
	columns: z
		.array(z.strictObject({ title: label, points: z.array(text(120)).min(1).max(5) }))
		.min(2)
		.max(3)
});

const hubSchema = z.strictObject({
	...base,
	type: z.literal('hub'),
	center: node,
	spokes: z.array(node).min(3).max(8)
});

const statsSchema = z.strictObject({
	...base,
	type: z.literal('stats'),
	// Numbers need a source with a year, so `source` is required here.
	source: text(160),
	items: z
		.array(z.strictObject({ value: text(16), unit: text(24).optional(), label, detail }))
		.min(2)
		.max(6)
});

const layersSchema = z.strictObject({
	...base,
	type: z.literal('layers'),
	/** `pyramid` narrows each layer towards the top; `stack` keeps them full width. */
	variant: z.enum(['stack', 'pyramid']).default('stack'),
	/** Top layer first. */
	layers: z.array(node).min(2).max(6)
});

export const infographicSchema = z.discriminatedUnion('type', [
	flowSchema,
	cycleSchema,
	timelineSchema,
	compareSchema,
	hubSchema,
	statsSchema,
	layersSchema
]);

/** "สรุปใน 30 วินาที": 3–5 one-line takeaways. */
export const takeawaysSchema = z.array(text(140)).min(3).max(5);

/** One main infographic, optionally a second small one. */
export const infographicsSchema = z.array(infographicSchema).min(1).max(2);

/** Every visible string of an infographic, in reading order (for full-text search). */
export function infographicText(infographic: Infographic): string[] {
	return [
		infographic.title,
		infographic.summary,
		...bodyText(infographic),
		infographic.source ?? ''
	]
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function bodyText(infographic: Infographic): string[] {
	const nodeText = (item: InfographicNode) => [item.label, item.detail ?? ''];
	switch (infographic.type) {
		case 'flow':
		case 'cycle':
			return infographic.steps.flatMap(nodeText);
		case 'timeline':
			return infographic.events.flatMap((item) => [item.date, ...nodeText(item)]);
		case 'compare':
			return infographic.columns.flatMap((column) => [column.title, ...column.points]);
		case 'hub':
			return [...nodeText(infographic.center), ...infographic.spokes.flatMap(nodeText)];
		case 'stats':
			return infographic.items.flatMap((item) => [item.value, item.unit ?? '', ...nodeText(item)]);
		case 'layers':
			return infographic.layers.flatMap(nodeText);
	}
}

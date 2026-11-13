import { describe, expect, it } from 'vitest';
import { VALID_SPECS } from './infographic.fixtures';
import {
	INFOGRAPHIC_TYPES,
	infographicSchema,
	infographicsSchema,
	infographicText,
	takeawaysSchema
} from './infographic';

const base = { title: 'หัวข้อภาพ', summary: 'ภาพนี้อธิบายอะไร' };
const nodes = (count: number) =>
	Array.from({ length: count }, (_, index) => ({ label: `ขั้น ${index + 1}` }));

describe('infographicSchema', () => {
	it.each(INFOGRAPHIC_TYPES)('accepts a minimal %s spec', (type) => {
		expect(infographicSchema.parse(VALID_SPECS[type]).type).toBe(type);
	});

	it('defaults layers to the stack variant', () => {
		const withoutVariant = { ...base, type: 'layers', layers: nodes(2) };
		expect(infographicSchema.parse(withoutVariant)).toMatchObject({ variant: 'stack' });
	});

	it.each([
		['an unknown type', { ...base, type: 'chart', steps: nodes(3) }],
		['a misspelled key (strict objects)', { ...base, type: 'flow', steps: nodes(3), titel: 'x' }],
		['a misspelled node key', { ...base, type: 'flow', steps: [{ label: 'ก', detial: 'x' }] }],
		['a flow with one step', { ...base, type: 'flow', steps: nodes(1) }],
		['a cycle with two steps', { ...base, type: 'cycle', steps: nodes(2) }],
		[
			'a hub with too many spokes',
			{ ...base, type: 'hub', center: { label: 'x' }, spokes: nodes(9) }
		],
		[
			'a compare with one column',
			{ ...base, type: 'compare', columns: [{ title: 'ก', points: ['x'] }] }
		],
		[
			'stats without a source',
			{
				...base,
				type: 'stats',
				items: [
					{ value: '1', label: 'x' },
					{ value: '2', label: 'y' }
				]
			}
		],
		['an empty label', { ...base, type: 'flow', steps: [{ label: '  ' }, { label: 'ข' }] }],
		[
			'a label over 60 characters',
			{ ...base, type: 'flow', steps: [{ label: 'ก'.repeat(61) }, { label: 'ข' }] }
		],
		['a missing summary', { title: 'x', type: 'flow', steps: nodes(2) }],
		['an unknown layers variant', { ...base, type: 'layers', variant: 'funnel', layers: nodes(2) }]
	])('rejects %s', (_name, spec) => {
		expect(infographicSchema.safeParse(spec).success).toBe(false);
	});
});

describe('takeawaysSchema and infographicsSchema', () => {
	it('needs 3–5 takeaways of at most 140 characters', () => {
		expect(takeawaysSchema.safeParse(['ก', 'ข', 'ค']).success).toBe(true);
		expect(takeawaysSchema.safeParse(['ก', 'ข']).success).toBe(false);
		expect(takeawaysSchema.safeParse(['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ']).success).toBe(false);
		expect(takeawaysSchema.safeParse(['ก', 'ข', 'ค'.repeat(141)]).success).toBe(false);
	});

	it('needs one or two infographics', () => {
		expect(infographicsSchema.safeParse([]).success).toBe(false);
		expect(infographicsSchema.safeParse([VALID_SPECS.flow]).success).toBe(true);
		expect(
			infographicsSchema.safeParse([VALID_SPECS.flow, VALID_SPECS.hub, VALID_SPECS.cycle]).success
		).toBe(false);
	});
});

describe('infographicText', () => {
	it('lists every visible string, including the source, without blanks', () => {
		expect(infographicText(VALID_SPECS.stats)).toEqual([
			'หัวข้อภาพ',
			'ภาพนี้อธิบายอะไร',
			'193',
			'ประเทศ',
			'สมาชิก UN',
			'5',
			'สมาชิกถาวร',
			'UN, 2024'
		]);
	});
});

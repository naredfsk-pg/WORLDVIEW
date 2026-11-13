import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { getLessonDetail, listLessonSummaries } from '#lib/content/academy.server.js';
import { INFOGRAPHIC_TYPES, VALID_SPECS } from '#lib/content/infographic.fixtures.js';
import { infographicText } from '#lib/content/infographic.js';
import type { Infographic as InfographicSpec } from '#lib/types/domain.js';
import LessonTakeaways from '../LessonTakeaways.svelte';
import Infographic from './Infographic.svelte';

const LIST_TAG: Record<InfographicSpec['type'], 'ol' | 'ul'> = {
	flow: 'ol',
	cycle: 'ol',
	timeline: 'ol',
	layers: 'ol',
	compare: 'ul',
	hub: 'ul',
	stats: 'ul'
};

function renderSpec(spec: InfographicSpec): string {
	return render(Infographic, { props: { spec } }).body;
}

describe('Infographic', () => {
	it.each(INFOGRAPHIC_TYPES)('renders a %s spec as a named figure with a text list', (type) => {
		const spec: InfographicSpec = VALID_SPECS[type];
		const body = renderSpec(spec);

		expect(body).toContain(`data-type="${type}"`);
		const labelledBy = /<figure[^>]*aria-labelledby="([^"]+)"/.exec(body)?.[1];
		const describedBy = /<figure[^>]*aria-describedby="([^"]+)"/.exec(body)?.[1];
		expect(body).toContain(`id="${labelledBy}"`);
		expect(body).toContain(`id="${describedBy}"`);
		expect(body).toContain(`<${LIST_TAG[type]}`);
		// Every string of the spec is real text on the page (the text equivalent).
		for (const text of infographicText(spec)) expect(body).toContain(text);
		// Shapes never carry meaning for assistive tech.
		for (const svg of body.match(/<svg[^>]*>/g) ?? []) expect(svg).toContain('aria-hidden="true"');
	});

	it('escapes spec text instead of rendering markup', () => {
		const body = renderSpec({
			...VALID_SPECS.flow,
			title: '<script>alert(1)</script>',
			steps: [{ label: '<img src=x onerror=alert(1)>' }, { label: 'ข' }]
		});
		expect(body).not.toContain('<script>');
		expect(body).not.toContain('<img');
		expect(body).toContain('&lt;script>');
	});

	it('shows the source of stats, and lays out a pyramid with growing layers', () => {
		expect(renderSpec(VALID_SPECS.stats)).toContain('ที่มา: UN, 2024');
		const pyramid = renderSpec({ ...VALID_SPECS.layers, variant: 'pyramid' });
		expect(pyramid).toContain('ภาพสรุป · พีระมิด');
		expect(pyramid.match(/--inset: ([\d.]+)/g)).toEqual([
			'--inset: 1',
			'--inset: 0.5',
			'--inset: 0'
		]);
	});

	it('renders hub spokes as one list, whatever the layout', () => {
		const body = renderSpec({
			...VALID_SPECS.hub,
			spokes: VALID_SPECS.flow.steps.concat(VALID_SPECS.flow.steps)
		});
		expect(body.match(/<ul/g)).toHaveLength(1);
		expect(body.match(/<li/g)).toHaveLength(6);
	});

	it('spells out "~", "<" and ">" in stats values for screen readers', () => {
		const body = renderSpec({
			...VALID_SPECS.stats,
			items: [
				{ value: '~2.1', label: 'ก' },
				{ value: '<1.5', label: 'ข' },
				{ value: '>20', unit: '%', label: 'ค' },
				{ value: '193', label: 'ง' }
			]
		});
		expect(body).toContain('<span class="sr-only">ประมาณ 2.1</span>');
		expect(body).toContain('<span class="sr-only">น้อยกว่า 1.5</span>');
		expect(body).toContain('<span class="sr-only">มากกว่า 20</span>');
		expect(body.match(/class="sr-only"/g)).toHaveLength(3);
	});

	it('numbers stacked layers but not pyramid layers', () => {
		expect(renderSpec(VALID_SPECS.layers)).toContain('size-7');
		expect(renderSpec({ ...VALID_SPECS.layers, variant: 'pyramid' })).not.toContain('size-7');
	});

	it('states the loop of a cycle in text, not only with the shape', () => {
		expect(renderSpec(VALID_SPECS.cycle)).toContain('วนกลับไปขั้นที่ 1');
	});
});

describe('LessonTakeaways', () => {
	it('renders the takeaways as a titled list', () => {
		const { body } = render(LessonTakeaways, { props: { takeaways: ['ก', 'ข', 'ค'] } });
		expect(body).toContain('สรุปใน 30 วินาที');
		expect(body.match(/<li/g)).toHaveLength(3);
	});
});

describe('every lesson', () => {
	it('renders its takeaways and infographics', () => {
		for (const summary of listLessonSummaries()) {
			const lesson = getLessonDetail(summary.week, summary.day)!;
			expect(lesson.takeaways.length, lesson.id).toBeGreaterThanOrEqual(3);
			for (const spec of lesson.infographics) {
				expect(renderSpec(spec), `${lesson.id} ${spec.type}`).toContain(spec.title);
			}
		}
	});
});

import { describe, expect, it } from 'vitest';
import { ACADEMY_WEEKS, renderLessonMarkdown } from './academy';
import { getAcademyWeeks, getLessonDetail, listLessonSummaries } from './academy.server';

describe('renderLessonMarkdown', () => {
	it('escapes raw HTML and <script> instead of rendering it', () => {
		const { html } = renderLessonMarkdown(
			'<script>alert(1)</script>\n\nข้อความ <img src=x onerror=alert(1)> <b>หนา</b>'
		);
		expect(html).not.toContain('<script');
		expect(html).not.toContain('<img');
		expect(html).not.toContain('<b>');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
	});

	it('links only https URLs and marks them noopener noreferrer', () => {
		const { html } = renderLessonMarkdown(
			'[ok](https://example.org/a) [js](javascript:alert(1)) [http](http://example.org) [data](data:text/html,x)'
		);
		expect(html).toContain(
			'<a href="https://example.org/a" target="_blank" rel="noopener noreferrer">ok</a>'
		);
		expect(html).not.toContain('href="javascript');
		expect(html).not.toContain('href="http://');
		expect(html).not.toContain('href="data:');
		expect(html.match(/<a /g)).toHaveLength(1);
	});

	it('does not render images', () => {
		const { html } = renderLessonMarkdown('![tracker](https://example.org/pixel.png)');
		expect(html).not.toContain('<img');
	});

	it('gives ## and ### headings section ids and builds the TOC', () => {
		const { html, toc } = renderLessonMarkdown(
			'## ภาพรวม\n\nข้อความ\n\n### ตัวอย่าง **สำคัญ**\n\n#### ไม่อยู่ใน TOC'
		);
		expect(toc).toEqual([
			{ id: 'section-1', text: 'ภาพรวม', level: 2 },
			{ id: 'section-2', text: 'ตัวอย่าง สำคัญ', level: 3 }
		]);
		expect(html).toContain('<h2 id="section-1">ภาพรวม</h2>');
		expect(html).toContain('<h3 id="section-2">');
		expect(html).toContain('<h4>ไม่อยู่ใน TOC</h4>');
	});
});

describe('academy content loaders', () => {
	it('exposes 4 weeks with 7/7/7/9 lessons and 30 summaries', () => {
		expect(ACADEMY_WEEKS).toHaveLength(4);
		expect(listLessonSummaries()).toHaveLength(30);
		expect(getAcademyWeeks().map((week) => week.lessons.length)).toEqual([7, 7, 7, 9]);
	});

	it('returns lesson detail only when the day belongs to the week', () => {
		const lesson = getLessonDetail(1, 1);
		expect(lesson?.id).toBe('w1-d01');
		expect(lesson?.toc.length).toBeGreaterThan(0);
		expect(getLessonDetail(2, 1)).toBeNull();
		expect(getLessonDetail(4, 31)).toBeNull();
	});
});

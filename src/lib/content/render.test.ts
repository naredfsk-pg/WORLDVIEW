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

	it('makes tables keyboard-focusable, because they scroll horizontally', () => {
		const { html } = renderLessonMarkdown(`| ก | ข |
|---|---|
| 1 | 2 |`);
		expect(html).toContain('<table tabindex="0">');
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

describe('renderLessonMarkdown reading path', () => {
	const long = 'ข้อความยาว '.repeat(40);

	it('keeps a section heading and first paragraph visible and folds a long remainder', () => {
		const { html } = renderLessonMarkdown(
			`บทนำก่อนหัวข้อ

## ภาพรวม **หลัก**

ย่อหน้าแรก

${long}

### ย่อย

- รายการ

## สรุปสั้น

- ข้อหนึ่ง
- ข้อสอง`
		);
		expect(html.startsWith('<p>บทนำก่อนหัวข้อ</p>')).toBe(true);
		expect(html.match(/<details class="lesson-more">/g)).toHaveLength(1);
		const [visible, folded] = html.split('<details class="lesson-more">');
		expect(visible).toContain('<h2 id="section-1">');
		expect(visible).toContain('<p>ย่อหน้าแรก</p>');
		expect(folded).toContain('<h3 id="section-2">ย่อย</h3>');
		expect(folded).toContain('<span class="sr-only">: ภาพรวม หลัก</span></summary>');
		// The short last section is not folded and nothing is lost.
		expect(html.indexOf('</details>')).toBeLessThan(html.indexOf('สรุปสั้น'));
		expect(html.trimEnd().endsWith('</ul>')).toBe(true);
		expect(html).toContain(long.trim());
	});

	it('does not fold a short remainder, and escapes the heading in the summary', () => {
		expect(
			renderLessonMarkdown(`## หัวข้อ

แรก

สั้น ๆ`).html
		).not.toContain('<details');
		const { html } = renderLessonMarkdown(`## <b>x</b>

แรก

${long}`);
		expect(html).toContain('<span class="sr-only">: &lt;b&gt;x&lt;/b&gt;</span>');
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

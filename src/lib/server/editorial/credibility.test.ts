import { describe, expect, it } from 'vitest';
import { assessCredibility, SINGLE_SOURCE_FLOOR_REASON_TH } from './credibility';

const REASON = 'ตัวเลขผู้ได้รับผลกระทบในรายงานแต่ละแหล่งไม่ตรงกัน';

describe('assessCredibility', () => {
	it('keeps the model label and a clean Thai reason', () => {
		expect(
			assessCredibility({
				assessed: { level: 'disputed', reason_th: REASON },
				sensitive: false,
				distinct_sources: 3
			})
		).toEqual({ credibility_level: 'disputed', credibility_reason_th: REASON });
	});

	it('no label means no reason', () => {
		expect(
			assessCredibility({
				assessed: { level: 'none', reason_th: REASON },
				sensitive: false,
				distinct_sources: 1
			})
		).toEqual({ credibility_level: 'none', credibility_reason_th: null });
		expect(assessCredibility({ assessed: null, sensitive: true, distinct_sources: 2 })).toEqual({
			credibility_level: 'none',
			credibility_reason_th: null
		});
	});

	it('floor: sensitive with fewer than 2 registry sources is at least unverified', () => {
		for (const sources of [0, 1]) {
			expect(
				assessCredibility({
					assessed: { level: 'none', reason_th: null },
					sensitive: true,
					distinct_sources: sources
				})
			).toEqual({
				credibility_level: 'unverified',
				credibility_reason_th: SINGLE_SOURCE_FLOOR_REASON_TH
			});
		}
	});

	it('the floor never lowers a stronger model label', () => {
		for (const level of ['disputed', 'possible_misinformation'] as const) {
			expect(
				assessCredibility({
					assessed: { level, reason_th: REASON },
					sensitive: true,
					distinct_sources: 1
				})
			).toEqual({ credibility_level: level, credibility_reason_th: REASON });
		}
	});

	it('a reason with a URL, contact details or no Thai is dropped, the level is kept', () => {
		for (const reason of ['ดูที่ evil.example.com', 'โทร 081-234-5678', 'not Thai', '  ']) {
			expect(
				assessCredibility({
					assessed: { level: 'possible_misinformation', reason_th: reason },
					sensitive: false,
					distinct_sources: 2
				})
			).toEqual({ credibility_level: 'possible_misinformation', credibility_reason_th: null });
		}
	});

	it('a dropped reason on a floored level falls back to the floor reason', () => {
		expect(
			assessCredibility({
				assessed: { level: 'unverified', reason_th: 'ดู www.example.com' },
				sensitive: true,
				distinct_sources: 1
			})
		).toEqual({
			credibility_level: 'unverified',
			credibility_reason_th: SINGLE_SOURCE_FLOOR_REASON_TH
		});
	});

	it('the fixed floor reason passes the Thai and G3 checks itself', () => {
		const result = assessCredibility({
			assessed: { level: 'unverified', reason_th: SINGLE_SOURCE_FLOOR_REASON_TH },
			sensitive: false,
			distinct_sources: 1
		});
		expect(result.credibility_reason_th).toBe(SINGLE_SOURCE_FLOOR_REASON_TH);
	});
});

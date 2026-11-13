import { describe, expect, it } from 'vitest';
import type { RelationGateInput } from '../../types/editorial';
import { selectLessonLinks } from './lesson-links';
import { evaluateRelation } from './relation-gate';

function relation(overrides: Partial<RelationGateInput> = {}): RelationGateInput {
	return {
		relation_type: 'follow_up',
		explanation_th: 'เหตุการณ์นี้เป็นความคืบหน้าต่อจากข่าวก่อนหน้า',
		evidence_article_ids: ['art-1'],
		from_article_ids: ['art-1'],
		to_article_ids: ['art-9'],
		confidence: 0.8,
		...overrides
	};
}

describe('evaluateRelation', () => {
	it('drops a relation without evidence, including causal ones', () => {
		expect(evaluateRelation(relation({ evidence_article_ids: [] }))).toMatchObject({
			action: 'drop'
		});
		expect(
			evaluateRelation(relation({ relation_type: 'potential_impact', evidence_article_ids: [] }))
		).toMatchObject({ action: 'drop' });
	});

	it('drops a relation whose evidence is not linked to either event', () => {
		expect(
			evaluateRelation(relation({ evidence_article_ids: ['art-1', 'art-404'] }))
		).toMatchObject({
			action: 'drop'
		});
	});

	it('drops a non-Thai explanation or one containing a URL', () => {
		expect(evaluateRelation(relation({ explanation_th: 'Follow-up story.' }))).toMatchObject({
			action: 'drop'
		});
		expect(evaluateRelation(relation({ explanation_th: 'ดูต่อที่ https://x.example' }))).toMatchObject({
			action: 'drop'
		});
	});

	it('drops an explanation with obfuscated links or contact details', () => {
		for (const explanation_th of [
			'ดูต่อที่ evil[.]com',
			'ติดต่อไลน์ @scam เพื่อรับข้อมูล',
			'โทร 081-234-5678 เพื่อสอบถาม'
		]) {
			expect(evaluateRelation(relation({ explanation_th }))).toMatchObject({ action: 'drop' });
		}
	});

	it('off / multi_source (and omitted): every type waits for review, whatever the confidence', () => {
		const types = [
			'same_topic',
			'follow_up',
			'response_to',
			'background_of',
			'potential_impact'
		] as const;
		for (const relation_type of types) {
			for (const confidence of [0, 0.6, 0.99, 1]) {
				for (const auto_publish of ['off', 'multi_source', undefined] as const) {
					expect(
						evaluateRelation(
							relation({ relation_type, confidence, auto_publish, evidence_article_ids: ['art-9'] })
						)
					).toEqual({ action: 'store', status: 'pending_review' });
				}
			}
		}
	});

	it('all: published at or above the threshold, dropped below it', () => {
		const at = (confidence: number, min_confidence?: number) =>
			evaluateRelation(relation({ confidence, min_confidence, auto_publish: 'all' }));
		expect(at(0.8, 0.8)).toEqual({ action: 'store', status: 'published' });
		expect(at(0.95, 0.8)).toEqual({ action: 'store', status: 'published' });
		expect(at(0.79, 0.8)).toMatchObject({ action: 'drop' });
		expect(at(0.5, 0.4)).toEqual({ action: 'store', status: 'published' });
		// Default threshold when none is passed: 0.8.
		expect(at(0.8)).toEqual({ action: 'store', status: 'published' });
		expect(at(0.7)).toMatchObject({ action: 'drop' });
	});

	it('all: evidence and G3 checks still drop a confident relation', () => {
		for (const overrides of [
			{ evidence_article_ids: [] },
			{ explanation_th: 'ดูต่อที่ evil[.]com' },
			{ explanation_th: 'English only' }
		]) {
			expect(
				evaluateRelation(relation({ ...overrides, confidence: 1, auto_publish: 'all' }))
			).toMatchObject({ action: 'drop' });
		}
	});
});

describe('selectLessonLinks', () => {
	const rationale = 'บทเรียนนี้ให้พื้นฐานของเหตุการณ์';
	const existing = new Set(['w1-d01', 'w1-d02', 'w1-d03', 'w2-d08', 'w3-d15', 'w4-d22']);

	it('keeps at most 3 unique links with a Thai rationale and no URL', () => {
		const links = selectLessonLinks(
			[
				{ lesson_id: 'w1-d01', rationale_th: rationale },
				{ lesson_id: 'w1-d01', rationale_th: rationale },
				{ lesson_id: 'w1-d02', rationale_th: 'English only' },
				{ lesson_id: 'w1-d03', rationale_th: 'อ่านเพิ่ม www.example.com' },
				{ lesson_id: 'w2-d08', rationale_th: rationale },
				{ lesson_id: 'w3-d15', rationale_th: rationale },
				{ lesson_id: 'w4-d22', rationale_th: rationale }
			],
			existing
		);
		expect(links.map((link) => link.lesson_id)).toEqual(['w1-d01', 'w2-d08', 'w3-d15']);
	});

	it('drops lesson ids that are not in the allowed set', () => {
		const links = selectLessonLinks(
			[
				{ lesson_id: 'w9-d99', rationale_th: rationale },
				{ lesson_id: 'constructor', rationale_th: rationale },
				{ lesson_id: 'w2-d08', rationale_th: rationale }
			],
			existing
		);
		expect(links.map((link) => link.lesson_id)).toEqual(['w2-d08']);
	});
});

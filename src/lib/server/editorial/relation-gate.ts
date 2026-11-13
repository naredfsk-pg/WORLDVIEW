/**
 * Relation gate (ARCHITECTURE §11, PRD §9.2): no relation exists without evidence from the two
 * events' own articles, and the model-written explanation must be Thai with no link or contact.
 * Publishing depends on the auto-publish policy (owner decision 2026-11-13):
 * - `all`: a valid relation with confidence ≥ `min_confidence` is published automatically (the UI
 *   marks it as AI-generated); below it, it is dropped, not queued for review.
 * - `off` / `multi_source` (and omitted): every valid relation waits for an admin, as in the
 *   security wave, so dev and tests keep the reviewed behaviour.
 */
import {
	DEFAULT_RELATION_AUTO_PUBLISH_MIN_CONFIDENCE,
	type RelationGateDecision,
	type RelationGateInput
} from '../../types/editorial';
import { containsLinkOrContact, isThaiText } from './text';

export function evaluateRelation(input: RelationGateInput): RelationGateDecision {
	if (input.evidence_article_ids.length === 0) return { action: 'drop', reason: 'no evidence' };

	const linkedIds = new Set([...input.from_article_ids, ...input.to_article_ids]);
	if (input.evidence_article_ids.some((id) => !linkedIds.has(id))) {
		return { action: 'drop', reason: 'evidence is not linked to either event' };
	}
	if (!isThaiText(input.explanation_th)) {
		return { action: 'drop', reason: 'explanation is not Thai' };
	}
	if (containsLinkOrContact(input.explanation_th)) {
		return { action: 'drop', reason: 'URL or contact details in explanation' };
	}
	if (input.auto_publish !== 'all') return { action: 'store', status: 'pending_review' };

	const minConfidence = input.min_confidence ?? DEFAULT_RELATION_AUTO_PUBLISH_MIN_CONFIDENCE;
	if (input.confidence < minConfidence) {
		return { action: 'drop', reason: 'confidence below the auto-publish threshold' };
	}
	return { action: 'store', status: 'published' };
}

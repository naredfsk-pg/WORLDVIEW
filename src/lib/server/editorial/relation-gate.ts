/**
 * Relation gate (ARCHITECTURE §11, PRD §9.2): no relation exists without evidence from the two
 * events' own articles, and causal types always wait for a human.
 */
import { CAUSAL_RELATION_TYPES, type RelationType } from '../../types/domain';
import type { RelationGateDecision, RelationGateInput } from '../../types/editorial';
import { containsUrl, isThaiText } from './text';

export const RELATION_PUBLISH_MIN_CONFIDENCE = 0.6;

const CAUSAL_TYPES: ReadonlySet<RelationType> = new Set(CAUSAL_RELATION_TYPES);

export function evaluateRelation(input: RelationGateInput): RelationGateDecision {
	if (input.evidence_article_ids.length === 0) return { action: 'drop', reason: 'no evidence' };

	const linkedIds = new Set([...input.from_article_ids, ...input.to_article_ids]);
	if (input.evidence_article_ids.some((id) => !linkedIds.has(id))) {
		return { action: 'drop', reason: 'evidence is not linked to either event' };
	}
	if (!isThaiText(input.explanation_th)) {
		return { action: 'drop', reason: 'explanation is not Thai' };
	}
	if (containsUrl(input.explanation_th)) return { action: 'drop', reason: 'URL in explanation' };

	if (CAUSAL_TYPES.has(input.relation_type)) return { action: 'store', status: 'pending_review' };
	return {
		action: 'store',
		status: input.confidence >= RELATION_PUBLISH_MIN_CONFIDENCE ? 'published' : 'pending_review'
	};
}

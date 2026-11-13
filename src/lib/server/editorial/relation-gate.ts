/**
 * Relation gate (ARCHITECTURE §11, PRD §9.2): no relation exists without evidence from the two
 * events' own articles, and every relation waits for a human. MVP decision (security wave): the
 * model writes `explanation_th`, which can assert cause and effect whatever the type, so no type
 * or confidence is published automatically any more; an admin approves each one.
 */
import type { RelationGateDecision, RelationGateInput } from '../../types/editorial';
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
	return { action: 'store', status: 'pending_review' };
}

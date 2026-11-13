import { z } from 'zod';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import {
	changeReason,
	entityId,
	failure,
	firstIssue,
	readForm,
	requireAdmin,
	revisionMeta,
	transitionResponse
} from '../admin-forms.server';
import type { Actions, PageServerLoad } from './$types';

/** `/admin/relations`: pending relations with their evidence links. */
export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	const { relations } = await getRepositories().admin.listReviewQueue();
	return { relations };
};

const reviewForm = z.object({ id: entityId, change_reason: changeReason });

/** Approve (→ published) or reject; both write a `content_revisions` row. */
function reviewAction(status: 'published' | 'rejected', successMessage: string) {
	return async ({ request, locals }: { request: Request; locals: App.Locals }) => {
		const admin = requireAdmin(locals);
		const form = await readForm(request);
		const parsed = reviewForm.safeParse(form);
		if (!parsed.success) {
			return failure(
				400,
				entityId.safeParse(form.id).data ?? null,
				firstIssue(parsed.error.issues)
			);
		}

		const result = await getRepositories().admin.reviewRelation(
			parsed.data.id,
			status,
			revisionMeta(admin, parsed.data.change_reason),
			new Date().toISOString()
		);
		return transitionResponse(result, parsed.data.id, successMessage);
	};
}

export const actions: Actions = {
	approve: reviewAction('published', 'อนุมัติความเชื่อมโยงแล้ว'),
	reject: reviewAction('rejected', 'ปฏิเสธความเชื่อมโยงแล้ว')
};

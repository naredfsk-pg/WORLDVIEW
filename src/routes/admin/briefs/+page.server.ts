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

const BRIEFS_SHOWN = 30;

/** `/admin/briefs`: the latest briefs with a hide / unhide toggle. */
export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	return { briefs: await getRepositories().admin.listRecentBriefs(BRIEFS_SHOWN) };
};

const visibilityForm = z.object({
	id: entityId,
	status: z.enum(['published', 'hidden'], { error: 'สถานะไม่ถูกต้อง' }),
	change_reason: changeReason
});

export const actions: Actions = {
	/** published ↔ hidden; writes a `content_revisions` row (entity `daily_brief`). */
	visibility: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await readForm(request);
		const parsed = visibilityForm.safeParse(form);
		if (!parsed.success) {
			return failure(
				400,
				entityId.safeParse(form.id).data ?? null,
				firstIssue(parsed.error.issues)
			);
		}

		const { id, status, change_reason } = parsed.data;
		const result = await getRepositories().admin.setBriefVisibility(
			id,
			status,
			revisionMeta(admin, change_reason),
			new Date().toISOString()
		);
		return transitionResponse(
			result,
			id,
			status === 'hidden' ? 'ซ่อนสรุปข่าวแล้ว' : 'เผยแพร่สรุปข่าวอีกครั้งแล้ว'
		);
	}
};

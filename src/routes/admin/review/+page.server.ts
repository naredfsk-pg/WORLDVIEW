import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { AdminReviewData } from '#lib/types/views.js';
import { eventStatusActions, requireAdmin } from '../admin-forms.server';
import type { Actions, PageServerLoad } from './$types';

const HIDDEN_EVENTS_SHOWN = 20;

/** `/admin/review`: pending events (and the relation count), plus hidden events to unhide. */
export const load: PageServerLoad = async ({ locals }) => {
	const admin = requireAdmin(locals);
	const repo = getRepositories().admin;
	const [queue, hidden] = await Promise.all([
		repo.listReviewQueue(),
		repo.listHiddenEvents(HIDDEN_EVENTS_SHOWN)
	]);
	const data: AdminReviewData = { admin, events: queue.events, relations: queue.relations };
	return { ...data, hidden_events: hidden };
};

export const actions: Actions = eventStatusActions;

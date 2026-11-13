import { requireAdmin } from './admin-forms.server';
import type { LayoutServerLoad } from './$types';

/** Every `/admin/*` page: the verified admin (set by hooks.server.ts) and the dev-bypass flag. */
export const load: LayoutServerLoad = ({ locals }) => ({
	admin: requireAdmin(locals),
	admin_dev_bypass: locals.adminDevBypass === true
});

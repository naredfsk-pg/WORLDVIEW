/**
 * Shared server code for the `/admin/*` form actions: input schemas (zod), the admin publish gate
 * (G1–G3) and the event status actions used by both `/admin/review` and `/admin/events/[id]`.
 * Every action requires `change_reason`; every write goes through `AdminRepository`, which
 * appends a `content_revisions` row in the same transaction.
 */
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import { filterAllegationTags, storedEventGateReasons } from '#lib/server/editorial/index.js';
import type { ReviewReason } from '#lib/types/domain.js';
import type {
	AdminRepository,
	AdminTransitionResult,
	EventWithArticles,
	RevisionMeta
} from '#lib/types/repositories.js';
import type { AdminIdentity } from '#lib/types/views.js';

/** What every admin action returns (as data, or inside `fail`). */
export interface AdminActionData {
	ok: boolean;
	message: string;
	/** The entity the action targeted, so the page shows the notice next to it. */
	id: string | null;
	reasons: ReviewReason[];
}

export const entityId = z
	.string()
	.trim()
	.regex(/^[A-Za-z0-9_-]{1,128}$/, 'รหัสรายการไม่ถูกต้อง');

export const changeReason = z
	.string({ error: 'กรุณาระบุเหตุผล' })
	.trim()
	.min(3, 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร')
	.max(300, 'เหตุผลยาวเกิน 300 ตัวอักษร');

const transitionForm = z.object({ id: entityId, change_reason: changeReason });

/** Defence in depth: the hook already denied requests without a verified admin. */
export function requireAdmin(locals: App.Locals): AdminIdentity {
	if (!locals.admin) error(403, 'ไม่มีสิทธิ์เข้าถึง');
	return locals.admin;
}

export async function readForm(request: Request): Promise<Record<string, FormDataEntryValue>> {
	return Object.fromEntries(await request.formData());
}

export function firstIssue(issues: readonly { message: string }[]): string {
	return issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
}

export function revisionMeta(admin: AdminIdentity, reason: string): RevisionMeta {
	return { changed_by: admin.email, change_reason: reason, public_note_th: null };
}

/**
 * Admin publish runs only the hard gates G1–G3 (ARCHITECTURE §11) on the stored row, including
 * the public credibility reason.
 */
export function adminPublishGate({
	event,
	articles
}: Pick<EventWithArticles, 'event' | 'articles'>): ReviewReason[] {
	return storedEventGateReasons(event, articles);
}

/** Maps a repository transition result to action data (`fail` for every error). */
export function transitionResponse(
	result: AdminTransitionResult,
	id: string,
	successMessage: string
) {
	if (result.ok) return { ok: true, message: successMessage, id, reasons: [] } as AdminActionData;
	if (result.error === 'gate_failed') {
		return failure(422, id, 'เผยแพร่ไม่ได้ เพราะไม่ผ่านเกณฑ์ G1–G3', result.reasons);
	}
	if (result.error === 'not_found') return failure(404, id, 'ไม่พบรายการนี้');
	if (result.error === 'conflict') {
		return failure(409, id, 'รายการนี้ถูกแก้ไขหลังจากคุณเปิดหน้านี้ กรุณาโหลดใหม่');
	}
	return failure(409, id, 'สถานะปัจจุบันของรายการไม่รองรับการทำรายการนี้');
}

export function failure(
	status: number,
	id: string | null,
	message: string,
	reasons: ReviewReason[] = []
) {
	return fail(status, { ok: false, message, id, reasons } satisfies AdminActionData);
}

type EventTransition = (
	admin: AdminRepository,
	id: string,
	meta: RevisionMeta,
	now: string
) => Promise<AdminTransitionResult>;

/** `?/publish` (also unhide), `?/hide`, `?/flag`: shared by the review queue and the edit page. */
export const eventStatusActions = {
	publish: (event: RequestEvent) =>
		runEventTransition(
			event,
			(admin, id, meta, now) =>
				admin.publishEvent(id, adminPublishGate, meta, now, filterAllegationTags),
			'เผยแพร่แล้ว'
		),
	hide: (event: RequestEvent) =>
		runEventTransition(event, (admin, id, meta, now) => admin.hideEvent(id, meta, now), 'ซ่อนแล้ว'),
	flag: (event: RequestEvent) =>
		runEventTransition(
			event,
			(admin, id, meta, now) => admin.flagEvent(id, meta, now),
			'ทำเครื่องหมายให้ตรวจสอบแล้ว (ระบบจะไม่เผยแพร่อัตโนมัติ)'
		)
};

async function runEventTransition(
	{ request, locals }: RequestEvent,
	apply: EventTransition,
	successMessage: string
) {
	const admin = requireAdmin(locals);
	const form = await readForm(request);
	const parsed = transitionForm.safeParse(form);
	const id = entityId.safeParse(form.id).data ?? null;
	if (!parsed.success) return failure(400, id, firstIssue(parsed.error.issues));

	const meta = revisionMeta(admin, parsed.data.change_reason);
	const result = await apply(
		getRepositories().admin,
		parsed.data.id,
		meta,
		new Date().toISOString()
	);
	return transitionResponse(result, parsed.data.id, successMessage);
}

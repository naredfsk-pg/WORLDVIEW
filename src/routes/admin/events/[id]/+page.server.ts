import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import { containsContact, containsUrl, isThaiText } from '#lib/server/editorial/index.js';
import { CATEGORY_SLUGS, CREDIBILITY_LEVELS } from '#lib/types/domain.js';
import type { AdminEventPatch } from '#lib/types/repositories.js';
import type { AdminEventEditData } from '#lib/types/views.js';
import {
	changeReason,
	entityId,
	eventStatusActions,
	readForm,
	requireAdmin,
	type AdminActionData
} from '../../admin-forms.server';
import type { Actions, PageServerLoad } from './$types';

const EDITABLE_FIELDS = [
	'title_th',
	'summary_th',
	'what_happened_th',
	'why_it_matters_th',
	'background_th',
	'uncertain_th',
	'category',
	'credibility_level',
	'credibility_reason_th'
] as const satisfies readonly (keyof AdminEventPatch)[];

type EditableField = (typeof EDITABLE_FIELDS)[number];

export interface SaveActionData extends AdminActionData {
	field_errors: Partial<Record<EditableField | 'change_reason' | 'public_note_th', string>>;
	/** The submitted values, so a rejected edit is not lost. */
	values: Record<string, string> | null;
}

/** `/admin/events/[id]`: any status (draft, pending, published, hidden), with sources and revisions. */
export const load: PageServerLoad = async ({ params, locals }): Promise<AdminEventEditData> => {
	const admin = requireAdmin(locals);
	const id = entityId.safeParse(params.id);
	const edit = id.success ? await getRepositories().admin.getEventForEdit(id.data) : null;
	if (!edit) error(404, 'ไม่พบเหตุการณ์นี้');
	return { admin, ...edit };
};

export const actions: Actions = {
	...eventStatusActions,

	/**
	 * Optimistic concurrency: the form carries the `updated_at` and the field values it was
	 * rendered with. The patch holds only fields whose submitted value differs from that LOADED
	 * value (never compared with the current row), and the repository writes it only while
	 * `updated_at` is unchanged; otherwise 409 and the input is kept.
	 */
	save: async ({ request, locals, params }) => {
		const admin = requireAdmin(locals);
		const form = await readForm(request);
		const values = Object.fromEntries(
			Object.entries(form).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string'
			)
		);
		if (!entityId.safeParse(params.id).success) {
			return saveFailure(404, params.id, 'ไม่พบเหตุการณ์นี้', {}, values);
		}

		const parsed = saveForm.safeParse(form);
		const loaded = loadedForm.safeParse(form);
		if (!loaded.success) {
			return saveFailure(400, params.id, RELOAD_MESSAGE, {}, values);
		}
		if (!parsed.success) {
			const fieldErrors: SaveActionData['field_errors'] = {};
			for (const issue of parsed.error.issues) {
				const field = String(issue.path[0]) as keyof SaveActionData['field_errors'];
				fieldErrors[field] ??= issue.message;
			}
			return saveFailure(400, params.id, 'บันทึกไม่ได้ กรุณาแก้ไขช่องที่แจ้งไว้', fieldErrors, values);
		}

		const { change_reason, public_note_th, ...fields } = parsed.data;
		const patch: AdminEventPatch = {};
		for (const field of EDITABLE_FIELDS) {
			const loadedValue = loaded.data[`original_${field}`];
			if (fields[field] !== loadedValue) Object.assign(patch, { [field]: fields[field] });
		}
		if (Object.keys(patch).length === 0) {
			return saveFailure(400, params.id, 'ไม่มีข้อมูลที่เปลี่ยนแปลง', {}, values);
		}
		// The label and its reason are one override: both are written (and so both kept from later
		// re-summaries), and a removed label keeps no reason.
		if ('credibility_level' in patch || 'credibility_reason_th' in patch) {
			patch.credibility_level = fields.credibility_level;
			patch.credibility_reason_th =
				fields.credibility_level === 'none' ? null : fields.credibility_reason_th;
		}

		const result = await getRepositories().admin.updateEventIfCurrent(
			params.id,
			loaded.data.loaded_updated_at,
			patch,
			{ changed_by: admin.email, change_reason, public_note_th },
			new Date().toISOString()
		);
		if (!result.ok && result.error === 'conflict') {
			return saveFailure(409, params.id, CONFLICT_MESSAGE, {}, values);
		}
		if (!result.ok) return saveFailure(404, params.id, 'ไม่พบเหตุการณ์นี้', {}, values);
		return {
			ok: true,
			message: 'บันทึกการแก้ไขแล้ว',
			id: params.id,
			reasons: [],
			field_errors: {},
			values: null
		} satisfies SaveActionData;
	}
};

const CONFLICT_MESSAGE =
	'มีการแก้ไขจากระบบหรือผู้อื่นหลังจากคุณเปิดหน้านี้ — โหลดใหม่ (ข้อความที่คุณพิมพ์ยังอยู่ในฟอร์ม คัดลอกไว้ก่อนโหลดใหม่)';
const RELOAD_MESSAGE = 'ฟอร์มไม่สมบูรณ์ กรุณาโหลดหน้านี้ใหม่แล้วแก้ไขอีกครั้ง';

function saveFailure(
	status: number,
	id: string,
	message: string,
	fieldErrors: SaveActionData['field_errors'],
	values: Record<string, string>
) {
	return fail(status, {
		ok: false,
		message,
		id,
		reasons: [],
		field_errors: fieldErrors,
		values
	} satisfies SaveActionData);
}

const NO_URL_MESSAGE = 'ห้ามมี URL หรือชื่อโดเมนในข้อความ (ลิงก์มาจากแหล่งข่าวที่บันทึกไว้เท่านั้น)';
const NO_CONTACT_MESSAGE = 'ห้ามมีเบอร์โทร ไอดีไลน์ หรืออีเมลในข้อความ';

/** Required Thai text (gate G2) with no URL or contact details (gate G3), so a saved event still passes the gates. */
function requiredThai(label: string, max: number) {
	return z
		.string({ error: `กรุณากรอก${label}` })
		.trim()
		.min(1, `กรุณากรอก${label}`)
		.max(max, `${label}ยาวเกิน ${max} ตัวอักษร`)
		.refine(isThaiText, `${label}ต้องมีข้อความภาษาไทย`)
		.refine((value) => !containsUrl(value), NO_URL_MESSAGE)
		.refine((value) => !containsContact(value), NO_CONTACT_MESSAGE);
}

/** Optional text, no URL or contact details (G3); empty → null. */
function optionalText(label: string, max: number) {
	return z
		.string()
		.trim()
		.max(max, `${label}ยาวเกิน ${max} ตัวอักษร`)
		.refine((value) => !containsUrl(value), NO_URL_MESSAGE)
		.refine((value) => !containsContact(value), NO_CONTACT_MESSAGE)
		.optional()
		.transform((value) => (value ? value : null));
}

/** A loaded value from a hidden field, normalized the way the edit fields are (trim, '' → null). */
const loadedValue = z
	.string()
	.max(10_000)
	.transform((value) => value.trim() || null);

/** What the form was rendered with: the version token and every editable field's value. */
const loadedForm = z.object({
	loaded_updated_at: z.string().min(1).max(40),
	original_title_th: loadedValue,
	original_summary_th: loadedValue,
	original_what_happened_th: loadedValue,
	original_why_it_matters_th: loadedValue,
	original_background_th: loadedValue,
	original_uncertain_th: loadedValue,
	original_category: loadedValue,
	original_credibility_level: loadedValue,
	original_credibility_reason_th: loadedValue
});

const saveForm = z.object({
	title_th: requiredThai('หัวข้อ', 200),
	summary_th: requiredThai('สรุปสั้น', 600),
	what_happened_th: requiredThai('เกิดอะไรขึ้น', 3000),
	why_it_matters_th: requiredThai('ทำไมจึงสำคัญ', 2000),
	background_th: optionalText('ภูมิหลัง', 3000),
	uncertain_th: optionalText('สิ่งที่ยังไม่ชัดเจน', 1500),
	category: z.enum(CATEGORY_SLUGS, { error: 'กรุณาเลือกหมวดหมู่' }),
	credibility_level: z.enum(CREDIBILITY_LEVELS, { error: 'กรุณาเลือกระดับป้าย' }),
	// Public text next to the label: G3 like every other field, and Thai when given.
	credibility_reason_th: optionalText('เหตุผลของป้าย', 300).refine(
		(value) => value === null || isThaiText(value),
		'เหตุผลของป้ายต้องมีข้อความภาษาไทย'
	),
	change_reason: changeReason,
	public_note_th: optionalText('หมายเหตุการแก้ไข', 300)
});

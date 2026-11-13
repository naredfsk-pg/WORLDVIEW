/** Thai labels and small display helpers for the admin pages (FR-06). Pure and client-safe. */
import type { BriefStatus, EventStatus, RelationStatus, ReviewReason } from '../../types/domain';
import type { JobStatus, JobType } from '../../types/jobs';

export const REVIEW_REASON_LABEL_TH: Record<ReviewReason, string> = {
	no_source: 'ไม่มีแหล่งข่าวที่อ้างอิงได้',
	llm_failed: 'AI สรุปไม่สำเร็จ (ระบบจะลองใหม่เอง)',
	invalid_llm_output: 'ผลลัพธ์จาก AI ไม่ผ่านการตรวจรูปแบบ',
	llm_request_rejected: 'คำขอไปยัง AI ถูกปฏิเสธ',
	unsupported_claim: 'มีข้อความที่ไม่มีหลักฐานรองรับ',
	url_in_generated_text: 'พบ URL ในข้อความ',
	contact_in_generated_text: 'พบเบอร์โทร ไอดีไลน์ หรืออีเมลในข้อความ',
	sensitive_single_source: 'ประเด็นอ่อนไหวที่มีแหล่งข่าวเดียว',
	missing_thai_fields: 'ข้อความภาษาไทยหรือหมวดหมู่ไม่ครบ',
	possible_duplicate: 'อาจซ้ำกับข่าวที่เผยแพร่แล้ว (ดูความเชื่อมโยงที่รอตรวจ)',
	auto_publish_disabled: 'ปิดการเผยแพร่อัตโนมัติ (รอผู้ดูแลอนุมัติ)',
	new_evidence_pending: 'มีข่าวใหม่เพิ่มเข้ามา ข้อความที่เผยแพร่ยังไม่ได้ปรับ',
	manual_flag: 'ผู้ดูแลทำเครื่องหมายให้ตรวจ'
};

export const EVENT_STATUS_LABEL_TH: Record<EventStatus, string> = {
	draft: 'ฉบับร่าง',
	pending_review: 'รอตรวจสอบ',
	published: 'เผยแพร่แล้ว',
	hidden: 'ซ่อนอยู่'
};

export const BRIEF_STATUS_LABEL_TH: Record<BriefStatus, string> = {
	draft: 'ฉบับร่าง (ไม่มีข่าวที่เข้าเกณฑ์)',
	published: 'เผยแพร่แล้ว',
	hidden: 'ซ่อนอยู่'
};

export const RELATION_STATUS_LABEL_TH: Record<RelationStatus, string> = {
	pending_review: 'รอตรวจสอบ',
	published: 'เผยแพร่แล้ว',
	rejected: 'ปฏิเสธแล้ว'
};

export const JOB_STATUS_LABEL_TH: Record<JobStatus, string> = {
	running: 'กำลังทำงาน',
	succeeded: 'สำเร็จ',
	partial: 'สำเร็จบางส่วน',
	failed: 'ล้มเหลว'
};

export const JOB_TYPE_LABEL_TH: Record<JobType, string> = {
	ingest: 'ดึงข่าว (ingest)',
	digest: 'สรุปและจัดกลุ่ม (digest)',
	brief_morning: 'สรุปรอบเช้า',
	brief_evening: 'สรุปรอบเย็น',
	archive_snapshot: 'บันทึกคลังรายวัน'
};

/** "1 นาที 5 วินาที" / "850 มิลลิวินาที"; "—" while still running. */
export function formatDuration(startedAt: string, finishedAt: string | null): string {
	if (!finishedAt) return '—';
	const ms = Date.parse(finishedAt) - Date.parse(startedAt);
	if (!Number.isFinite(ms) || ms < 0) return '—';
	if (ms < 1000) return `${ms} มิลลิวินาที`;
	const seconds = Math.round(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	return minutes > 0 ? `${minutes} นาที ${seconds % 60} วินาที` : `${seconds} วินาที`;
}

/** "12,345 / 600,000 (2%)" */
export function formatUsage(used: number, max: number): string {
	const percent = max > 0 ? Math.round((used / max) * 100) : 0;
	return `${used.toLocaleString('en-US')} / ${max.toLocaleString('en-US')} (${percent}%)`;
}

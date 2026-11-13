/**
 * Demo news fixtures, ported from the UI prototype (`worldview-ui-prototype/worldview-ui/index.html`,
 * stories s1–s12). EVERYTHING here is fictional: sources are labelled DEMO, URLs live under
 * `https://example.com/demo/...`, and every row is written with `is_demo = true`.
 *
 * Times are given in Bangkok time and converted with an explicit +07:00 offset. Brief membership
 * follows the ARCHITECTURE §8 windows (morning D = D-1 07:00 → D 07:00, evening D = D-1 19:00 → D 19:00).
 * Ids are fixed so the seed is idempotent.
 */
import type {
	BriefEdition,
	CategorySlug,
	CountryCode,
	EditorialSignals,
	EventRelation,
	RegionSlug,
	ReviewReason,
	Tag
} from '../../../types/domain';
import type { SourceDefinition } from '../../../types/news';

/** Bangkok wall-clock time → UTC ISO, e.g. ict('2026-11-13 07:00') → '2026-11-13T00:00:00.000Z'. */
function ict(dateTime: string): string {
	return new Date(`${dateTime.replace(' ', 'T')}:00+07:00`).toISOString();
}

export const DEMO_URL_BASE = 'https://example.com/demo';
export const DEMO_EDITOR = 'demo-editor@example.com';

export const DEMO_SOURCES: SourceDefinition[] = ['a', 'b', 'c'].map((letter, index) => ({
	id: `demo-wire-${letter}`,
	name: `DEMO · สำนักข่าวสมมติ ${['ก', 'ข', 'ค'][index]}`,
	kind: 'rss',
	homepage_url: `${DEMO_URL_BASE}/wire-${letter}`,
	feed_url: `${DEMO_URL_BASE}/wire-${letter}/feed.xml`,
	link_hosts: ['example.com'],
	license_notes: 'Fictional demo source for development and UI previews. Not real news.',
	allow_excerpt: false,
	is_demo: true,
	// Never fetched: demo rows are written by the seed only.
	enabled: false
}));

export interface DemoArticle {
	id: string;
	source_id: string;
	title: string;
	published_at: string | null;
}

export interface DemoEvent {
	id: string;
	status: 'published' | 'pending_review';
	review_reasons: ReviewReason[];
	title_th: string;
	summary_th: string;
	what_happened_th: string;
	why_it_matters_th: string;
	background_th: string | null;
	uncertain_th: string | null;
	claims: { claimant_th: string; claim_th: string; article_ids: string[] }[];
	category: CategorySlug;
	regions: RegionSlug[];
	countries: CountryCode[];
	tags: Tag[];
	signals: EditorialSignals;
	occurred_at: string | null;
	articles: DemoArticle[];
	updates: { id: string; reported_at: string; update_text_th: string; article_ids: string[] }[];
	/** Links to lessons missing from the catalog are skipped by the seed with a warning. */
	lessons: { lesson_id: string; rationale_th: string }[];
}

function article(id: string, wire: 'a' | 'b' | 'c', title: string, at: string): DemoArticle {
	return { id, source_id: `demo-wire-${wire}`, title: `[ตัวอย่าง] ${title}`, published_at: ict(at) };
}

export const DEMO_EVENTS: DemoEvent[] = [
	{
		id: 'demo-evt-01',
		status: 'published',
		review_reasons: [],
		title_th: 'นโยบายเทคโนโลยีระหว่างมหาอำนาจ ส่งผลต่อโลกอย่างไร?',
		summary_th: 'ตัวอย่างการอธิบายความเชื่อมโยงระหว่างนโยบายการค้า ชิปขั้นสูง และการแข่งขันด้าน AI',
		what_happened_th:
			'สถานการณ์จำลอง: รัฐบาลประกาศมาตรการใหม่ที่เกี่ยวข้องกับเทคโนโลยีขั้นสูง โดยหลายฝ่ายกำลังประเมินผลที่จะเกิดกับผู้ผลิตและคู่ค้า',
		why_it_matters_th:
			'การส่งออกชิปและเครื่องมือผลิตชิปสามารถกระทบทั้งต้นทุน การลงทุนวิจัย และห่วงโซ่อุปทานข้ามประเทศ',
		background_th: 'การควบคุมการค้าสินค้าเทคโนโลยีมีบริบทจากการแข่งขันอุตสาหกรรมและความมั่นคงของประเทศ',
		uncertain_th: 'ผลกระทบขึ้นอยู่กับขอบเขตมาตรการ การบังคับใช้ และการตอบสนองของผู้เกี่ยวข้อง',
		claims: [
			{
				claimant_th: 'โฆษกรัฐบาลในสถานการณ์จำลอง',
				claim_th: 'มาตรการนี้มีเป้าหมายเพื่อความมั่นคงทางเทคโนโลยี ไม่ใช่เพื่อกีดกันการค้า',
				article_ids: ['demo-art-01a']
			}
		],
		category: 'geopolitics',
		regions: ['americas', 'asia'],
		countries: [],
		tags: ['technology-policy', 'semiconductors', 'export-controls', 'us-china'],
		signals: { impact_breadth: 3, thailand_relevance: 2, sensitive: false },
		occurred_at: null,
		articles: [
			article('demo-art-01a', 'a', 'รัฐบาลสมมติประกาศมาตรการคุมส่งออกเทคโนโลยี', '2026-11-13 05:45'),
			article('demo-art-01b', 'b', 'ผู้ผลิตชิปประเมินผลกระทบมาตรการใหม่', '2026-11-13 06:05'),
			article('demo-art-01c', 'c', 'คู่ค้าในเอเชียจับตามาตรการเทคโนโลยี', '2026-11-13 06:20')
		],
		updates: [
			{
				id: 'demo-upd-01-1',
				reported_at: ict('2026-11-13 06:40'),
				update_text_th: 'ผู้ผลิตตัวอย่างหลายรายแจ้งว่ากำลังทบทวนแผนการส่งมอบสินค้าในไตรมาสถัดไป',
				article_ids: ['demo-art-01c']
			}
		],
		lessons: [
			{
				lesson_id: 'w1-d07',
				rationale_th: 'ช่วยเข้าใจการแข่งขันระหว่างสหรัฐฯ และจีนที่เป็นฉากหลังของนโยบายนี้'
			},
			{ lesson_id: 'w3-d18', rationale_th: 'อธิบายว่าทำไมอุตสาหกรรมชิปจึงเป็นประเด็นเชิงยุทธศาสตร์' }
		]
	},
	{
		id: 'demo-evt-02',
		status: 'published',
		review_reasons: [],
		title_th: 'ทำไมการตัดสินใจเรื่องดอกเบี้ยจึงส่งผลไปทั่วโลก',
		summary_th: 'อธิบายความเชื่อมโยงระหว่างดอกเบี้ย ค่าเงิน ตลาดทุน และภาระต้นทุนของธุรกิจ',
		what_happened_th: 'ตัวอย่างประเด็นสำหรับข่าวเศรษฐกิจ: การเปลี่ยนแปลงอัตราดอกเบี้ยหรือแนวโน้มนโยบายการเงิน',
		why_it_matters_th: 'การเปลี่ยนดอกเบี้ยส่งผลต่อต้นทุนเงินทุน การกู้ยืม และทิศทางเงินลงทุนระหว่างประเทศ',
		background_th: 'นโยบายการเงินมักใช้เพื่อรักษาเสถียรภาพราคาและเศรษฐกิจ',
		uncertain_th: 'ทิศทางของตลาดไม่สามารถสรุปได้จากปัจจัยดอกเบี้ยเพียงอย่างเดียว',
		claims: [],
		category: 'economy',
		regions: ['global'],
		countries: [],
		tags: ['interest-rates', 'central-banks', 'inflation'],
		signals: { impact_breadth: 3, thailand_relevance: 3, sensitive: false },
		occurred_at: null,
		articles: [
			article('demo-art-02a', 'a', 'ธนาคารกลางสมมติส่งสัญญาณนโยบายดอกเบี้ย', '2026-11-13 04:30'),
			article('demo-art-02b', 'b', 'ตลาดเงินตอบสนองต่อสัญญาณดอกเบี้ย', '2026-11-13 05:10')
		],
		updates: [],
		lessons: [
			{ lesson_id: 'w2-d10', rationale_th: 'อธิบายบทบาทของธนาคารกลางและเครื่องมือดอกเบี้ย' },
			{ lesson_id: 'w2-d09', rationale_th: 'เชื่อมดอกเบี้ยกับกลไกการเกิดเงินเฟ้อ' }
		]
	},
	{
		id: 'demo-evt-03',
		status: 'published',
		review_reasons: [],
		title_th: 'โครงสร้างพื้นฐาน AI กลายเป็นประเด็นเศรษฐกิจและพลังงาน',
		summary_th: 'ทำไม Data Center, GPU และกำลังไฟฟ้าจึงต้องถูกมองเป็นเรื่องเดียวกัน',
		what_happened_th: 'ตัวอย่างหัวข้อ AI infrastructure: ความต้องการทรัพยากรสำหรับประมวลผลโมเดลขนาดใหญ่',
		why_it_matters_th: 'กำลังประมวลผลสัมพันธ์กับต้นทุนและโครงสร้างพื้นฐานด้านไฟฟ้า',
		background_th: 'การเติบโตของการใช้ AI ทำให้หลายบริษัทลงทุนใน Data Center',
		uncertain_th: 'การลงทุนและการใช้ไฟฟ้าจริงต่างกันตามประสิทธิภาพและการใช้งาน',
		claims: [],
		category: 'technology',
		regions: ['global'],
		countries: [],
		tags: ['ai', 'data-centers', 'electricity'],
		signals: { impact_breadth: 2, thailand_relevance: 2, sensitive: false },
		occurred_at: null,
		articles: [
			article('demo-art-03a', 'b', 'บริษัทสมมติเร่งลงทุน Data Center', '2026-11-13 03:15'),
			article('demo-art-03b', 'c', 'ความต้องการ GPU กดดันโครงสร้างพื้นฐาน', '2026-11-13 03:50')
		],
		updates: [],
		lessons: [{ lesson_id: 'w4-d22', rationale_th: 'ปูพื้นว่า AI เปลี่ยนเศรษฐกิจและสังคมอย่างไร' }]
	},
	{
		id: 'demo-evt-04',
		status: 'published',
		review_reasons: [],
		title_th: 'เส้นทางขนส่งพลังงานเกี่ยวข้องกับราคาสินค้าอย่างไร',
		summary_th: 'สำรวจกลไกที่ทำให้ต้นทุนขนส่งน้ำมันกระทบราคาสินค้าและเงินเฟ้อ',
		what_happened_th: 'ตัวอย่างสถานการณ์: ความเสี่ยงด้านการขนส่งในเส้นทางพลังงานสำคัญ',
		why_it_matters_th: 'หากต้นทุนขนส่งเพิ่ม อาจส่งผ่านไปยังต้นทุนผลิตสินค้า',
		background_th: 'ระบบการค้าระหว่างประเทศพึ่งพาทั้งเส้นทางเดินเรือและเครือข่ายผู้ผลิต',
		uncertain_th: 'การเปลี่ยนราคาไม่ได้ขึ้นกับความขัดแย้งเพียงปัจจัยเดียว',
		claims: [],
		category: 'energy',
		regions: ['middle-east', 'global'],
		countries: [],
		tags: ['oil', 'shipping-routes', 'inflation'],
		signals: { impact_breadth: 3, thailand_relevance: 3, sensitive: false },
		occurred_at: ict('2026-11-13 05:00'),
		articles: [
			article('demo-art-04a', 'a', 'ค่าระวางเรือขนส่งพลังงานปรับตัว', '2026-11-13 06:10'),
			article('demo-art-04b', 'c', 'ผู้นำเข้าน้ำมันจับตาเส้นทางเดินเรือ', '2026-11-13 06:30')
		],
		updates: [
			{
				id: 'demo-upd-04-1',
				reported_at: ict('2026-11-13 06:50'),
				update_text_th: 'บริษัทเดินเรือตัวอย่างแจ้งว่ายังเดินเรือตามตารางเดิม แต่ติดตามสถานการณ์ใกล้ชิด',
				article_ids: ['demo-art-04b']
			}
		],
		lessons: [
			{ lesson_id: 'w3-d19', rationale_th: 'อธิบายความสำคัญของเส้นทางเดินเรือน้ำมันและก๊าซ' },
			{ lesson_id: 'w3-d16', rationale_th: 'ให้บริบทเรื่องตะวันออกกลางกับตลาดพลังงาน' }
		]
	},
	{
		id: 'demo-evt-05',
		status: 'published',
		review_reasons: [],
		title_th: 'สังคมสูงวัยกำลังเปลี่ยนรูปแบบการทำงานและเศรษฐกิจ',
		summary_th: 'มองความเปลี่ยนแปลงด้านประชากรผ่านตลาดแรงงานและสวัสดิการ',
		what_happened_th: 'ตัวอย่างหัวข้อประชากรศาสตร์: สัดส่วนประชากรสูงอายุเพิ่มขึ้นในหลายประเทศ',
		why_it_matters_th: 'โครงสร้างอายุมีผลต่อแรงงาน ผลิตภาพ และภาระด้านสาธารณสุข',
		background_th: 'อัตราการเกิดและอายุขัยล้วนส่งผลต่อโครงสร้างประชากร',
		uncertain_th: 'แต่ละประเทศรับมือความเปลี่ยนแปลงไม่เหมือนกัน',
		claims: [],
		category: 'society',
		regions: ['asia', 'europe'],
		countries: [],
		tags: ['ageing-society', 'labour-market', 'demographics'],
		signals: { impact_breadth: 2, thailand_relevance: 3, sensitive: false },
		occurred_at: null,
		// Single source on purpose: the UI must show "มีแหล่งข่าวเดียว".
		articles: [article('demo-art-05a', 'b', 'รายงานสมมติชี้สัดส่วนผู้สูงอายุเพิ่มขึ้น', '2026-11-13 01:30')],
		updates: [],
		lessons: [{ lesson_id: 'w4-d25', rationale_th: 'อธิบายผลของโลกสูงวัยต่อเศรษฐกิจและสังคม' }]
	},
	{
		id: 'demo-evt-06',
		status: 'published',
		review_reasons: [],
		title_th: 'บทบาทของพันธมิตรระหว่างประเทศในการจัดการวิกฤต',
		summary_th: 'เข้าใจว่าความร่วมมือด้านความมั่นคงและการทูตมีข้อจำกัดอย่างไร',
		what_happened_th: 'ตัวอย่างหัวข้อการทูต: การปรึกษาหารือของประเทศพันธมิตร',
		why_it_matters_th: 'ความร่วมมือระหว่างประเทศอาจมีผลต่อการตัดสินใจด้านความมั่นคง',
		background_th: 'ระบบพันธมิตรมีรากฐานจากประวัติศาสตร์และผลประโยชน์ร่วมกัน',
		uncertain_th: 'ท่าทีทางการทูตไม่เท่ากับการลงมือดำเนินนโยบายจริง',
		claims: [],
		category: 'geopolitics',
		regions: ['europe', 'global'],
		countries: [],
		tags: ['alliances', 'diplomacy', 'nato'],
		signals: { impact_breadth: 2, thailand_relevance: 1, sensitive: false },
		occurred_at: null,
		// 00:40 ICT = 17:40 UTC the previous day: event_date must still be 2026-11-13.
		articles: [
			article('demo-art-06a', 'a', 'ประเทศพันธมิตรสมมติเปิดการหารือฉุกเฉิน', '2026-11-13 00:40'),
			article('demo-art-06b', 'c', 'นักการทูตสมมติประเมินผลการหารือ', '2026-11-13 01:05')
		],
		updates: [],
		lessons: [{ lesson_id: 'w1-d06', rationale_th: 'ปูพื้นเรื่องบทบาทของ UN, NATO และ ASEAN' }]
	},
	{
		id: 'demo-evt-07',
		status: 'published',
		review_reasons: [],
		title_th: 'ห่วงโซ่อุปทานชิปมีขั้นตอนสำคัญอะไรบ้าง',
		summary_th: 'ตั้งแต่การออกแบบชิปถึงการผลิตขั้นสูง ความร่วมมือข้ามประเทศสำคัญอย่างไร',
		what_happened_th: 'ประเด็นจำลองเกี่ยวกับ Semiconductor Supply Chain',
		why_it_matters_th: 'การผลิตชิปขั้นสูงต้องอาศัยเครื่องมือและความเชี่ยวชาญจากหลายแห่ง',
		background_th: 'อุตสาหกรรมชิปมีการแบ่งงานตามความเชี่ยวชาญสูง',
		uncertain_th: 'การเปลี่ยนแปลงต้นทุนและการผลิตขึ้นกับหลายปัจจัย',
		claims: [],
		category: 'technology',
		regions: ['asia', 'americas'],
		countries: [],
		tags: ['semiconductors', 'supply-chain'],
		signals: { impact_breadth: 2, thailand_relevance: 2, sensitive: false },
		occurred_at: null,
		articles: [
			article('demo-art-07a', 'a', 'ผู้ผลิตชิปสมมติขยายกำลังการผลิต', '2026-11-12 08:40'),
			article('demo-art-07b', 'b', 'เครื่องมือผลิตชิปขาดแคลนในตลาดตัวอย่าง', '2026-11-12 09:30'),
			article('demo-art-07c', 'c', 'นักวิเคราะห์สมมติอธิบายห่วงโซ่อุปทานชิป', '2026-11-12 10:15')
		],
		updates: [],
		lessons: [
			{ lesson_id: 'w3-d20', rationale_th: 'อธิบายแร่หายากและวัตถุดิบของอุตสาหกรรม Semiconductor' },
			{ lesson_id: 'w3-d18', rationale_th: 'ให้บริบทไต้หวันกับการผลิตชิปขั้นสูง' },
			{ lesson_id: 'w2-d13', rationale_th: 'เชื่อมกับแนวคิดห่วงโซ่อุปทานโลก' }
		]
	},
	{
		id: 'demo-evt-08',
		status: 'published',
		review_reasons: [],
		title_th: 'ค่าเงินผันผวนบอกอะไรเกี่ยวกับความเชื่อมั่นตลาด',
		summary_th: 'ความสัมพันธ์ของเงินทุนระหว่างประเทศ ดอกเบี้ย และต้นทุนการนำเข้า',
		what_happened_th: 'ตัวอย่างสรุปเศรษฐกิจเกี่ยวกับค่าเงิน',
		why_it_matters_th: 'ค่าเงินกระทบผู้ส่งออก ผู้นำเข้า และหนี้ต่างประเทศ',
		background_th: 'ตลาดแลกเปลี่ยนสะท้อนความต้องการซื้อขายเงินตราหลายประเภท',
		uncertain_th: 'ไม่สามารถตีความค่าเงินจากตัวชี้วัดเดียว',
		claims: [],
		category: 'economy',
		regions: ['global'],
		countries: [],
		tags: ['currency', 'exchange-rates', 'capital-flows'],
		signals: { impact_breadth: 2, thailand_relevance: 3, sensitive: false },
		occurred_at: null,
		articles: [
			article('demo-art-08a', 'b', 'ค่าเงินในตลาดตัวอย่างแกว่งตัวแรง', '2026-11-12 15:20'),
			article('demo-art-08b', 'c', 'ผู้ส่งออกสมมติรับมือค่าเงินผันผวน', '2026-11-12 17:00')
		],
		updates: [],
		lessons: [{ lesson_id: 'w2-d11', rationale_th: 'อธิบายกลไกค่าเงินและอัตราแลกเปลี่ยน' }]
	},
	{
		id: 'demo-evt-09',
		status: 'published',
		review_reasons: [],
		title_th: 'ระบบไฟฟ้ารองรับความต้องการใช้พลังงานใหม่อย่างไร',
		summary_th: 'มองภาพ Grid, Data Center และความมั่นคงของพลังงาน',
		what_happened_th: 'ตัวอย่างสถานการณ์เรื่องความพร้อมของโครงข่ายไฟฟ้า',
		why_it_matters_th: 'ความต้องการไฟฟ้าใหม่อาจต้องใช้เวลาลงทุนระบบส่งและผลิต',
		background_th: 'ไฟฟ้าต้องมีความสมดุลระหว่างอุปสงค์และกำลังผลิต',
		uncertain_th: 'ปริมาณความต้องการขึ้นกับรูปแบบการใช้งานจริง',
		claims: [],
		category: 'energy',
		regions: ['global'],
		countries: [],
		tags: ['electricity', 'power-grid', 'data-centers'],
		signals: { impact_breadth: 2, thailand_relevance: 2, sensitive: false },
		occurred_at: null,
		articles: [
			article('demo-art-09a', 'a', 'ผู้ดูแลโครงข่ายไฟฟ้าสมมติเตรียมแผนรองรับ', '2026-11-12 12:10'),
			article('demo-art-09b', 'b', 'Data Center ตัวอย่างขอเพิ่มกำลังไฟ', '2026-11-12 13:00')
		],
		updates: [],
		lessons: [{ lesson_id: 'w4-d23', rationale_th: 'ให้ภาพรวมพลังงานกับอนาคตของโลก' }]
	},
	{
		id: 'demo-evt-10',
		status: 'published',
		review_reasons: [],
		title_th: 'การค้าโลกกับความสัมพันธ์ของประเทศมหาอำนาจ',
		summary_th: 'เหตุใดมาตรการการค้าจึงเป็นทั้งเครื่องมือทางเศรษฐกิจและการทูต',
		what_happened_th: 'ตัวอย่างประเด็นเรื่องการค้าและนโยบายระหว่างประเทศ',
		why_it_matters_th: 'กติกาการค้าส่งผลต่อการผลิตและราคาสินค้า',
		background_th: 'ความสัมพันธ์ทางการค้าถูกกำหนดโดยข้อตกลงและนโยบายรัฐ',
		uncertain_th: 'ผลของมาตรการเฉพาะต้องวิเคราะห์ตามรายละเอียด',
		claims: [
			{
				claimant_th: 'ผู้แทนการค้าในสถานการณ์จำลอง',
				claim_th: 'การเจรจารอบถัดไปจะช่วยลดความตึงเครียดทางการค้า',
				article_ids: ['demo-art-10b']
			}
		],
		category: 'geopolitics',
		regions: ['global'],
		countries: [],
		tags: ['trade-policy', 'tariffs', 'us-china'],
		signals: { impact_breadth: 3, thailand_relevance: 2, sensitive: false },
		occurred_at: null,
		articles: [
			article('demo-art-10a', 'a', 'มหาอำนาจสมมติทบทวนมาตรการภาษีนำเข้า', '2026-11-11 08:15'),
			article('demo-art-10b', 'c', 'ผู้แทนการค้าสมมติเตรียมเจรจารอบใหม่', '2026-11-11 09:00')
		],
		updates: [
			{
				id: 'demo-upd-10-1',
				reported_at: ict('2026-11-12 07:30'),
				update_text_th: 'มีการประกาศกำหนดการเจรจารอบถัดไป (ข้อมูลตัวอย่าง)',
				article_ids: ['demo-art-10b']
			}
		],
		lessons: [{ lesson_id: 'w1-d07', rationale_th: 'ให้บริบทความสัมพันธ์สหรัฐฯ–จีนในโลกปัจจุบัน' }]
	},
	{
		id: 'demo-evt-11',
		status: 'published',
		review_reasons: [],
		title_th: 'วิกฤตภูมิอากาศกระทบความมั่นคงด้านอาหารอย่างไร',
		summary_th: 'เชื่อมข้อมูลสภาพอากาศ การเกษตร และราคาสินค้า',
		what_happened_th: 'ตัวอย่างหัวข้อสภาพภูมิอากาศและอาหาร',
		why_it_matters_th: 'ภัยธรรมชาติสามารถส่งผลต่อปริมาณผลผลิตและการขนส่ง',
		background_th: 'ห่วงโซ่อาหารโลกเชื่อมโยงการผลิตกับการค้า',
		uncertain_th: 'ผลกระทบแตกต่างกันตามพื้นที่และมาตรการรับมือ',
		claims: [],
		category: 'society',
		regions: ['global'],
		countries: [],
		tags: ['climate', 'food-security'],
		signals: { impact_breadth: 2, thailand_relevance: 2, sensitive: false },
		occurred_at: null,
		articles: [article('demo-art-11a', 'c', 'รายงานสมมติเตือนผลผลิตเกษตรลดลง', '2026-11-11 12:00')],
		updates: [],
		lessons: [{ lesson_id: 'w4-d24', rationale_th: 'อธิบาย Climate Change ในภาพใหญ่' }]
	},
	{
		id: 'demo-evt-12',
		status: 'published',
		review_reasons: [],
		title_th: 'ทำไมชิปขั้นสูงถึงเป็นทรัพยากรเชิงยุทธศาสตร์',
		summary_th: 'ทำความเข้าใจความสำคัญของเทคโนโลยีการประมวลผล',
		what_happened_th: 'ตัวอย่างการปูพื้นฐานความสำคัญของชิป',
		why_it_matters_th: 'ชิปขับเคลื่อนระบบดิจิทัลและ AI',
		background_th: 'การออกแบบและผลิตชิปมีความซับซ้อนและใช้เงินลงทุนสูง',
		uncertain_th: 'ความสำคัญของชิปแต่ละชนิดแตกต่างกัน',
		claims: [],
		category: 'technology',
		regions: ['global'],
		countries: [],
		tags: ['semiconductors', 'ai'],
		signals: { impact_breadth: 2, thailand_relevance: 1, sensitive: false },
		occurred_at: null,
		articles: [article('demo-art-12a', 'a', 'บทวิเคราะห์สมมติ: ชิปคือทรัพยากรใหม่', '2026-11-10 10:30')],
		updates: [],
		lessons: [{ lesson_id: 'w3-d20', rationale_th: 'เชื่อมกับเรื่องแร่หายากและ Semiconductor' }]
	},
	{
		// Must NEVER appear publicly: pending review (sensitive + single source, gate G6).
		id: 'demo-evt-13',
		status: 'pending_review',
		review_reasons: ['sensitive_single_source'],
		title_th: 'ตัวอย่างข่าวรอตรวจสอบ: รายงานการปะทะบริเวณชายแดนสมมติ',
		summary_th: 'ข่าวตัวอย่างที่มีแหล่งข่าวเดียวในประเด็นอ่อนไหว จึงต้องรอผู้ดูแลตรวจสอบก่อนเผยแพร่',
		what_happened_th: 'สถานการณ์จำลอง: มีรายงานจากแหล่งข่าวเดียวเกี่ยวกับเหตุปะทะบริเวณชายแดน',
		why_it_matters_th: 'ประเด็นความขัดแย้งต้องมีหลักฐานจากหลายแหล่งก่อนนำเสนอ',
		background_th: null,
		uncertain_th: 'ยังไม่มีแหล่งข่าวอื่นยืนยัน',
		claims: [],
		category: 'geopolitics',
		regions: ['asia'],
		countries: [],
		tags: ['conflict', 'border-dispute'],
		signals: { impact_breadth: 1, thailand_relevance: 1, sensitive: true },
		occurred_at: null,
		articles: [article('demo-art-13a', 'b', 'รายงานสมมติ: เหตุปะทะบริเวณชายแดน', '2026-11-13 02:20')],
		updates: [],
		lessons: [{ lesson_id: 'w3-d15', rationale_th: 'เกี่ยวกับรากของความขัดแย้ง' }]
	}
];

export type DemoRelation = Omit<EventRelation, 'evidence_refs'> & {
	evidence_article_ids: string[];
};

export const DEMO_RELATIONS: DemoRelation[] = [
	{
		id: 'demo-rel-01',
		from_event_id: 'demo-evt-12',
		to_event_id: 'demo-evt-07',
		relation_type: 'background_of',
		explanation_th: 'ความสำคัญเชิงยุทธศาสตร์ของชิปเป็นพื้นฐานของการทำความเข้าใจห่วงโซ่อุปทานชิป',
		evidence_article_ids: ['demo-art-12a', 'demo-art-07a'],
		status: 'published',
		confidence: 0.82,
		created_at: ict('2026-11-12 11:00'),
		reviewed_at: null,
		reviewed_by: null
	},
	{
		id: 'demo-rel-02',
		from_event_id: 'demo-evt-01',
		to_event_id: 'demo-evt-10',
		relation_type: 'follow_up',
		explanation_th: 'มาตรการเทคโนโลยีเป็นพัฒนาการต่อจากประเด็นการค้าระหว่างมหาอำนาจ',
		evidence_article_ids: ['demo-art-01a', 'demo-art-10a'],
		status: 'published',
		confidence: 0.7,
		created_at: ict('2026-11-13 06:45'),
		reviewed_at: null,
		reviewed_by: null
	},
	{
		id: 'demo-rel-03',
		from_event_id: 'demo-evt-03',
		to_event_id: 'demo-evt-09',
		relation_type: 'same_topic',
		explanation_th: 'ทั้งสองเรื่องพูดถึงความต้องการไฟฟ้าของ Data Center',
		evidence_article_ids: ['demo-art-03a', 'demo-art-09b'],
		status: 'published',
		confidence: 0.75,
		created_at: ict('2026-11-13 06:45'),
		reviewed_at: null,
		reviewed_by: null
	},
	{
		// Causal type: always human-reviewed, and the UI must label it "อาจส่งผล (ยังไม่ยืนยัน)".
		id: 'demo-rel-04',
		from_event_id: 'demo-evt-04',
		to_event_id: 'demo-evt-02',
		relation_type: 'potential_impact',
		explanation_th: 'ต้นทุนขนส่งพลังงานที่สูงขึ้นอาจกดดันเงินเฟ้อ และอาจมีผลต่อการตัดสินใจเรื่องดอกเบี้ย (ยังไม่ยืนยัน)',
		evidence_article_ids: ['demo-art-04a', 'demo-art-02a'],
		status: 'published',
		confidence: 0.6,
		created_at: ict('2026-11-13 06:50'),
		reviewed_at: ict('2026-11-13 06:58'),
		reviewed_by: DEMO_EDITOR
	},
	{
		id: 'demo-rel-05',
		from_event_id: 'demo-evt-01',
		to_event_id: 'demo-evt-07',
		relation_type: 'response_to',
		explanation_th: 'มาตรการเทคโนโลยีถูกอธิบายว่าเป็นการตอบสนองต่อความกังวลเรื่องห่วงโซ่อุปทานชิป',
		evidence_article_ids: ['demo-art-01b', 'demo-art-07b'],
		status: 'published',
		confidence: 0.65,
		created_at: ict('2026-11-13 06:50'),
		reviewed_at: ict('2026-11-13 06:58'),
		reviewed_by: DEMO_EDITOR
	},
	{
		// Pending: must not appear publicly.
		id: 'demo-rel-06',
		from_event_id: 'demo-evt-05',
		to_event_id: 'demo-evt-11',
		relation_type: 'same_topic',
		explanation_th: 'ทั้งสองเรื่องเกี่ยวกับความเปลี่ยนแปลงเชิงโครงสร้างของสังคม',
		evidence_article_ids: ['demo-art-05a', 'demo-art-11a'],
		status: 'pending_review',
		confidence: 0.45,
		created_at: ict('2026-11-13 06:50'),
		reviewed_at: null,
		reviewed_by: null
	},
	{
		// Published edge to a pending event: hidden because one endpoint is not public.
		id: 'demo-rel-07',
		from_event_id: 'demo-evt-06',
		to_event_id: 'demo-evt-13',
		relation_type: 'same_topic',
		explanation_th: 'ทั้งสองเรื่องเกี่ยวกับความมั่นคงระหว่างประเทศ',
		evidence_article_ids: ['demo-art-06a', 'demo-art-13a'],
		status: 'published',
		confidence: 0.6,
		created_at: ict('2026-11-13 06:50'),
		reviewed_at: null,
		reviewed_by: null
	}
];

export interface DemoBrief {
	id: string;
	brief_date: string;
	edition: BriefEdition;
	published_at: string;
	/** Rank = position + 1. */
	items: { event_id: string; selection_reason: string }[];
}

const REASON = {
	impact: 'ผลกระทบกว้างต่อหลายภูมิภาค (ข้อมูลตัวอย่าง)',
	thailand: 'เกี่ยวข้องกับเศรษฐกิจไทยโดยตรง (ข้อมูลตัวอย่าง)',
	continuing: 'มีพัฒนาการต่อเนื่องจากข่าวก่อนหน้า (ข้อมูลตัวอย่าง)',
	context: 'ช่วยให้เข้าใจบริบทของข่าวอื่นในวันเดียวกัน (ข้อมูลตัวอย่าง)',
	balance: 'เพิ่มความหลากหลายของหมวดและภูมิภาค (ข้อมูลตัวอย่าง)'
};

export const DEMO_BRIEFS: DemoBrief[] = [
	{
		id: 'demo-brief-2026-11-10-evening',
		brief_date: '2026-11-10',
		edition: 'evening',
		published_at: ict('2026-11-10 19:00'),
		items: [{ event_id: 'demo-evt-12', selection_reason: REASON.context }]
	},
	{
		id: 'demo-brief-2026-11-10-daily_snapshot',
		brief_date: '2026-11-10',
		edition: 'daily_snapshot',
		published_at: ict('2026-11-11 01:00'),
		items: [{ event_id: 'demo-evt-12', selection_reason: REASON.context }]
	},
	{
		id: 'demo-brief-2026-11-11-morning',
		brief_date: '2026-11-11',
		edition: 'morning',
		published_at: ict('2026-11-11 07:00'),
		items: [{ event_id: 'demo-evt-12', selection_reason: REASON.context }]
	},
	{
		id: 'demo-brief-2026-11-11-evening',
		brief_date: '2026-11-11',
		edition: 'evening',
		published_at: ict('2026-11-11 19:00'),
		items: [
			{ event_id: 'demo-evt-10', selection_reason: REASON.impact },
			{ event_id: 'demo-evt-11', selection_reason: REASON.balance }
		]
	},
	{
		id: 'demo-brief-2026-11-11-daily_snapshot',
		brief_date: '2026-11-11',
		edition: 'daily_snapshot',
		published_at: ict('2026-11-12 01:00'),
		items: [
			{ event_id: 'demo-evt-10', selection_reason: REASON.impact },
			{ event_id: 'demo-evt-11', selection_reason: REASON.balance },
			{ event_id: 'demo-evt-12', selection_reason: REASON.context }
		]
	},
	{
		id: 'demo-brief-2026-11-12-morning',
		brief_date: '2026-11-12',
		edition: 'morning',
		published_at: ict('2026-11-12 07:00'),
		items: [
			{ event_id: 'demo-evt-10', selection_reason: REASON.continuing },
			{ event_id: 'demo-evt-11', selection_reason: REASON.balance }
		]
	},
	{
		id: 'demo-brief-2026-11-12-evening',
		brief_date: '2026-11-12',
		edition: 'evening',
		published_at: ict('2026-11-12 19:00'),
		items: [
			{ event_id: 'demo-evt-07', selection_reason: REASON.impact },
			{ event_id: 'demo-evt-09', selection_reason: REASON.context },
			{ event_id: 'demo-evt-08', selection_reason: REASON.thailand }
		]
	},
	{
		id: 'demo-brief-2026-11-12-daily_snapshot',
		brief_date: '2026-11-12',
		edition: 'daily_snapshot',
		published_at: ict('2026-11-13 01:00'),
		items: [
			{ event_id: 'demo-evt-07', selection_reason: REASON.impact },
			{ event_id: 'demo-evt-10', selection_reason: REASON.continuing },
			{ event_id: 'demo-evt-08', selection_reason: REASON.thailand },
			{ event_id: 'demo-evt-09', selection_reason: REASON.context },
			{ event_id: 'demo-evt-11', selection_reason: REASON.balance }
		]
	},
	{
		id: 'demo-brief-2026-11-13-morning',
		brief_date: '2026-11-13',
		edition: 'morning',
		published_at: ict('2026-11-13 07:00'),
		items: [
			{ event_id: 'demo-evt-01', selection_reason: REASON.impact },
			{ event_id: 'demo-evt-02', selection_reason: REASON.thailand },
			{ event_id: 'demo-evt-04', selection_reason: REASON.thailand },
			{ event_id: 'demo-evt-03', selection_reason: REASON.context },
			{ event_id: 'demo-evt-06', selection_reason: REASON.balance },
			{ event_id: 'demo-evt-05', selection_reason: REASON.balance }
		]
	}
];

/** A public correction, so the event page has a "corrections" entry to render. */
export const DEMO_REVISIONS = [
	{
		id: 'demo-rev-08-1',
		entity_type: 'event' as const,
		entity_id: 'demo-evt-08',
		changed_at: ict('2026-11-12 20:00'),
		changed_by: DEMO_EDITOR,
		change_reason: 'demo: clarify the "why it matters" wording',
		public_note_th: 'ปรับถ้อยคำในส่วน "ทำไมเรื่องนี้สำคัญ" ให้ชัดเจนขึ้น (ตัวอย่างการแจ้งแก้ไข)',
		before_after: {
			before: { why_it_matters_th: 'ค่าเงินกระทบผู้ส่งออกและผู้นำเข้า' },
			after: { why_it_matters_th: 'ค่าเงินกระทบผู้ส่งออก ผู้นำเข้า และหนี้ต่างประเทศ' }
		}
	}
];

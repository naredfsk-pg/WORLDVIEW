/** Minimal valid infographic specs, one per type (tests only). */
import type { Infographic } from '../types/domain';

const base = { title: 'หัวข้อภาพ', summary: 'ภาพนี้อธิบายอะไร' };
const nodes = (count: number) =>
	Array.from({ length: count }, (_, index) => ({ label: `ขั้น ${index + 1}` }));

export const VALID_SPECS = {
	flow: { ...base, type: 'flow', steps: nodes(3) },
	cycle: { ...base, type: 'cycle', steps: nodes(3) },
	timeline: {
		...base,
		type: 'timeline',
		events: [
			{ date: '1914', label: 'เริ่มสงคราม' },
			{ date: '1917', label: 'สหรัฐฯ เข้าร่วม' },
			{ date: '1918', label: 'สงบศึก', detail: '11 พฤศจิกายน' }
		]
	},
	compare: {
		...base,
		type: 'compare',
		columns: [
			{ title: 'ก', points: ['หนึ่ง'] },
			{ title: 'ข', points: ['สอง'] }
		]
	},
	hub: { ...base, type: 'hub', center: { label: 'อำนาจรัฐ' }, spokes: nodes(4) },
	stats: {
		...base,
		type: 'stats',
		source: 'UN, 2024',
		items: [
			{ value: '193', unit: 'ประเทศ', label: 'สมาชิก UN' },
			{ value: '5', label: 'สมาชิกถาวร' }
		]
	},
	layers: { ...base, type: 'layers', variant: 'stack', layers: nodes(3) }
} satisfies { [Type in Infographic['type']]: Extract<Infographic, { type: Type }> };

/** Every infographic type, from the fixtures (which must cover all of them). */
export const INFOGRAPHIC_TYPES = Object.keys(VALID_SPECS) as Infographic['type'][];

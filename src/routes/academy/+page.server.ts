import { getAcademyWeeks } from '#lib/content/academy.server.js';
import type { AcademyPageData } from '#lib/types/views.js';
import type { PageServerLoad } from './$types';

/** `/academy`: 4 weeks / 30 lessons, read from the content files. */
export const load: PageServerLoad = (): AcademyPageData => ({ weeks: getAcademyWeeks() });

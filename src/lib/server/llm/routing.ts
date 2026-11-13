/** Per-task model routing and request-parameter rules (ARCHITECTURE §10). Pure. */
import type { LlmTask, ModelRoute } from '../../types/llm';

/** Same field names as `AppConfig['llm']['models']`, so `config.llm.models` can be passed as-is. */
export interface LlmModelSettings {
	/** LLM_MODEL_ID */
	default: string | undefined;
	tagging: string | undefined;
	clustering: string | undefined;
	extraction: string | undefined;
	summary: string | undefined;
	relations: string | undefined;
	academyLinking: string | undefined;
	/** For `cc/*` and any other prefix. */
	fallback: string | undefined;
	/** For `cx/*`. */
	fallbackSecondary: string | undefined;
}

const MODEL_SETTING_BY_TASK = {
	tagging: 'tagging',
	clustering: 'clustering',
	extraction: 'extraction',
	summary: 'summary',
	relations: 'relations',
	academy_linking: 'academyLinking'
} as const satisfies Record<LlmTask, keyof LlmModelSettings>;

/** `LLM_MODEL_<TASK> ?? LLM_MODEL_ID`, plus a cross-vendor fallback. Null → `not_configured`. */
export function resolveModelRoute(task: LlmTask, models: LlmModelSettings): ModelRoute | null {
	const primary = models[MODEL_SETTING_BY_TASK[task]] ?? models.default;
	if (!primary) return null;

	const fallback = primary.startsWith('cx/') ? models.fallbackSecondary : models.fallback;
	return { primary, fallback: fallback && fallback !== primary ? fallback : null };
}

/** `LLM_OMIT_TEMPERATURE_FOR`: exact model ids, or prefixes when an entry ends in `*`. */
export function shouldOmitTemperature(model: string, omitFor: readonly string[]): boolean {
	return omitFor.some((entry) =>
		entry.endsWith('*') ? model.startsWith(entry.slice(0, -1)) : model === entry
	);
}

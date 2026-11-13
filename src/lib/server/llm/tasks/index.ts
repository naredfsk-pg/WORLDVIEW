/** Task registry: one definition (schema, prompt, prompt version, ref check) per `LlmTask`. */
import { LLM_TASKS, type LlmTask } from '../../../types/llm';
import { academyLinkingTask } from './academy-linking';
import { clusteringTask } from './clustering';
import { extractionTask } from './extraction';
import { relationsTask } from './relations';
import type { TaskDefinition } from './shared';
import { summaryTask } from './summary';
import { taggingTask } from './tagging';

export type { TaskDefinition } from './shared';

export const TASK_DEFINITIONS: { [T in LlmTask]: TaskDefinition<T> } = {
	tagging: taggingTask,
	clustering: clusteringTask,
	extraction: extractionTask,
	summary: summaryTask,
	relations: relationsTask,
	academy_linking: academyLinkingTask
};

/** Derived from the definitions, so a version lives in exactly one place. */
export const PROMPT_VERSIONS = Object.fromEntries(
	LLM_TASKS.map((task) => [task, TASK_DEFINITIONS[task].promptVersion])
) as Record<LlmTask, string>;

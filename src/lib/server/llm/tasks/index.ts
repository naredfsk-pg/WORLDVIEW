/** Task registry: one definition (schema, prompt, prompt version, ref check) per `LlmTask`. */
import type { LlmTask } from '../../../types/llm';
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

export const PROMPT_VERSIONS: Record<LlmTask, string> = {
	tagging: taggingTask.promptVersion,
	clustering: clusteringTask.promptVersion,
	extraction: extractionTask.promptVersion,
	summary: summaryTask.promptVersion,
	relations: relationsTask.promptVersion,
	academy_linking: academyLinkingTask.promptVersion
};

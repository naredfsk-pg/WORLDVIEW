import { describe, expect, it } from 'vitest';
import { LLM_TASKS } from '../../types/llm';
import { parseConfig } from '../config';
import { resolveModelRoute, shouldOmitTemperature } from './routing';

describe('resolveModelRoute', () => {
	it('uses LLM_MODEL_<TASK> and falls back to LLM_MODEL_ID for every unset task', () => {
		const { models } = parseConfig({
			LLM_MODEL_ID: 'cc/default-model',
			LLM_MODEL_TAGGING: 'cx/fast-model',
			LLM_MODEL_ACADEMY_LINKING: 'cc/linker-model'
		}).llm;

		const primaries = Object.fromEntries(
			LLM_TASKS.map((task) => [task, resolveModelRoute(task, models)?.primary])
		);
		expect(primaries).toEqual({
			tagging: 'cx/fast-model',
			clustering: 'cc/default-model',
			extraction: 'cc/default-model',
			summary: 'cc/default-model',
			relations: 'cc/default-model',
			academy_linking: 'cc/linker-model'
		});
	});

	it('returns null (not_configured) when neither the task model nor LLM_MODEL_ID is set', () => {
		const { models } = parseConfig({}).llm;
		expect(resolveModelRoute('summary', models)).toBeNull();
	});

	it('falls back cross-vendor: cc/* → LLM_MODEL_FALLBACK, cx/* → LLM_MODEL_FALLBACK_SECONDARY', () => {
		const { models } = parseConfig({
			LLM_MODEL_ID: 'cc/big',
			LLM_MODEL_TAGGING: 'cx/fast',
			LLM_MODEL_CLUSTERING: 'other/model',
			LLM_MODEL_FALLBACK: 'cx/fallback',
			LLM_MODEL_FALLBACK_SECONDARY: 'cc/fallback'
		}).llm;

		expect(resolveModelRoute('summary', models)).toEqual({
			primary: 'cc/big',
			fallback: 'cx/fallback'
		});
		expect(resolveModelRoute('tagging', models)).toEqual({
			primary: 'cx/fast',
			fallback: 'cc/fallback'
		});
		expect(resolveModelRoute('clustering', models)).toEqual({
			primary: 'other/model',
			fallback: 'cx/fallback'
		});
	});

	it('has no fallback when it is unset or equal to the primary', () => {
		const unset = parseConfig({ LLM_MODEL_ID: 'cc/big' }).llm.models;
		const same = parseConfig({ LLM_MODEL_ID: 'cc/big', LLM_MODEL_FALLBACK: 'cc/big' }).llm.models;

		expect(resolveModelRoute('summary', unset)?.fallback).toBeNull();
		expect(resolveModelRoute('summary', same)?.fallback).toBeNull();
	});
});

describe('shouldOmitTemperature', () => {
	const omitFor = parseConfig({ LLM_OMIT_TEMPERATURE_FOR: 'cc/claude-haiku-5-5, cx/reasoning-*' })
		.llm.omitTemperatureFor;

	it('matches exact ids only', () => {
		expect(shouldOmitTemperature('cc/claude-haiku-5-5', omitFor)).toBe(true);
		expect(shouldOmitTemperature('cc/claude-haiku-5-5-preview', omitFor)).toBe(false);
		expect(shouldOmitTemperature('cc/claude-sonnet-5-5', omitFor)).toBe(false);
	});

	it('matches entries ending in * as prefixes', () => {
		expect(shouldOmitTemperature('cx/reasoning-large', omitFor)).toBe(true);
		expect(shouldOmitTemperature('cx/reasoning-', omitFor)).toBe(true);
		expect(shouldOmitTemperature('cx/gpt-6-luna', omitFor)).toBe(false);
	});
});

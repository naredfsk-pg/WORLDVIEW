import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './client';

const opened: Db[] = [];
const tempDirs: string[] = [];

afterEach(() => {
	opened.splice(0).forEach((db) => db.$client.close());
	tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function open(databaseUrl: string): Db {
	const db = openDb(databaseUrl);
	opened.push(db);
	return db;
}

describe('openDb', () => {
	it('creates the parent directory and applies WAL, foreign keys and busy_timeout', () => {
		const dir = mkdtempSync(join(tmpdir(), 'worldview-db-'));
		tempDirs.push(dir);

		const sqlite = open(`file:${join(dir, 'nested', 'test.db')}`).$client;

		expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
		expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
	});

	it('rejects URLs without the file: scheme', () => {
		expect(() => openDb('./data/worldview.db')).toThrow(/DATABASE_URL/);
	});

	it('supports FTS5 full-text search (PRD §6 search layer)', () => {
		const sqlite = open(':memory:').$client;

		sqlite.exec(`CREATE VIRTUAL TABLE docs USING fts5(title, body, tokenize = 'unicode61')`);
		const insert = sqlite.prepare('INSERT INTO docs (title, body) VALUES (?, ?)');
		insert.run('Ceasefire talks', 'Negotiators meet in Geneva');
		insert.run('ราคาน้ำมัน', 'ตลาด energy ผันผวน');

		const match = sqlite.prepare('SELECT title FROM docs WHERE docs MATCH ? ORDER BY rank');
		expect(match.all('geneva')).toEqual([{ title: 'Ceasefire talks' }]);
		expect(match.all('energy')).toEqual([{ title: 'ราคาน้ำมัน' }]);
	});
});

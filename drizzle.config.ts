import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/lib/server/db/schema.ts',
	out: './migrations',
	dbCredentials: { url: process.env.DATABASE_URL ?? 'file:./data/worldview.db' },
	strict: true,
	verbose: true
});

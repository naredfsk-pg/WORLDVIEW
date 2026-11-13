# WORLDVIEW production image (ARCHITECTURE §17, README "Deploy").
# One image, two roles: `app` (default CMD: migrate, academy:sync, node build) and `scheduler`
# (supercronic + docker/crontab). Build with `docker compose build`.
#
# Base image pinned by exact version tag and index digest (multi-arch). To upgrade Node: pick the
# new tag, then `docker buildx imagetools inspect node:<tag>` and copy its "Digest" here (both FROMs).

# ---------------------------------------------------------------------------------------------
# Build stage: full dependencies, production build, then prune to production dependencies.
# ---------------------------------------------------------------------------------------------
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /app

# NODE_ENV=production for the build too: Vite derives import.meta.env.DEV from it, which compiles
# the admin dev bypass out of the bundle (ARCHITECTURE §4.7). --include=dev is then needed, because
# npm skips devDependencies when NODE_ENV=production.
ENV NODE_ENV=production

# --ignore-scripts: better-sqlite3 ships prebuilt binaries (prebuilds/linux-x64.node), but npm
# still tries an implicit `node-gyp rebuild` for it, which needs a C++ toolchain this image does
# not have. The only other install scripts are esbuild's (dev, optional: it finds its platform
# binary package without them). `prepare` (svelte-kit sync) runs inside `vite build` anyway.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund

COPY . .
# 1. `build` = SvelteKit (adapter-node) into build/; `build:scripts` = the CLI jobs bundled into
#    build/scripts/*.js, so production runs them with plain node (no tsx or dev deps at runtime).
# 2. Production-build guard (security review finding 4): drop the source maps (they embed the
#    original source, dev branch included; nothing at runtime reads them), then fail the build if
#    the admin dev bypass marker is anywhere in build/: `verify:prod-build` plus a plain grep.
# 3. Prune to production dependencies. better-sqlite3 ships prebuilt binaries for every platform
#    plus the SQLite sources; only the Linux binaries are kept.
RUN npm run build \
	&& npm run build:scripts \
	&& find build -name '*.map' -type f -delete \
	&& npm run verify:prod-build \
	&& if grep -rl 'dev@localhost' build/server build/client build/scripts; then \
		echo 'dev@localhost found in build/: not a production build' >&2; exit 1; \
	fi \
	&& npm prune --omit=dev --ignore-scripts --no-audit --no-fund \
	&& rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src node_modules/better-sqlite3/build \
	&& find node_modules/better-sqlite3/prebuilds -type f ! -name 'linux-*' -delete

# ---------------------------------------------------------------------------------------------
# Runtime stage: production node_modules, the build output, migrations and lesson files only.
# ---------------------------------------------------------------------------------------------
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	DATABASE_URL=file:/data/worldview.db \
	BACKUP_DIR=/backups

# supercronic (cron for containers) for the scheduler service, pinned by version and sha256.
# https://github.com/aptible/supercronic/releases/tag/v0.2.51 (linux-amd64)
ADD --checksum=sha256:cc232108374e8e2b537045f2d5eaa1229f619db314c3ba6a14d38b35dc0aa123 --chmod=0755 \
	https://github.com/aptible/supercronic/releases/download/v0.2.51/supercronic-linux-amd64 \
	/usr/local/bin/supercronic

# App files stay owned by root (read-only for the `node` user); only /data and /backups are
# writable (mode 700, owner node), and compose mounts a volume / host folder there.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/content/academy ./content/academy
COPY --from=build /app/docker ./docker

# Fail the build early if the native SQLite binding cannot load or the crontab does not parse.
RUN mkdir -p /data /backups \
	&& chown node:node /data /backups \
	&& chmod 700 /data /backups \
	&& node -e "const D=require('better-sqlite3');const db=new D(':memory:');console.log('better-sqlite3 ok, sqlite', db.prepare('select sqlite_version() v').get().v);db.close()" \
	&& supercronic -test docker/crontab

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["sh", "docker/start-app.sh"]

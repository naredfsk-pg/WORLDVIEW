# WORLDVIEW — Agent Work Plan (Phase 1 / MVP)

> Orchestrator: main Claude Code session · Created: 2026-11-13 09:47 (Asia/Bangkok)
> Sources of truth: [`WORLDVIEW_PROJECT_REQUIREMENTS.md`](../WORLDVIEW_PROJECT_REQUIREMENTS.md) (PRD) ·
> [`worldview-ui-prototype/worldview-ui/UI_DESIGN_SPEC.md`](../worldview-ui-prototype/worldview-ui/UI_DESIGN_SPEC.md) +
> [`index.html`](../worldview-ui-prototype/worldview-ui/index.html) (visual/interaction reference)
> Work log: [`AGENT_LOG.md`](AGENT_LOG.md) (timeline) + [`agent-logs/`](agent-logs/) (one detailed file per agent run)

---

## 1. Decisions locked so far

| Topic | Decision |
|---|---|
| Stack | SvelteKit + TypeScript (strict) + Tailwind CSS + Drizzle + SQLite (WAL) + Vitest/Playwright · `adapter-node` |
| UI | Match `worldview-ui-prototype` (layout, tokens, Thai tone, light/dark). Components via **shadcn-svelte** (Svelte port of shadcn/ui; copied into repo, built on bits-ui). Prototype tokens (`--bg`, `--surface`, `--accent`, …) mapped onto shadcn CSS vars. Font: self-hosted Noto Sans Thai. |
| Navigation | Follow prototype: mobile bottom nav **วันนี้ · เรียนรู้ · ย้อนหลัง · เชื่อมโยง**; desktop 235px sidebar; search in header (button + `/`) plus `/search` route. `/connections` in MVP = relation list (graph = Phase 2). Event detail = canonical route `/events/[id]` (not modal). |
| Event categories | 5 slugs with Thai labels: `geopolitics` ภูมิรัฐศาสตร์ · `economy` เศรษฐกิจ · `technology` เทคโนโลยี · `energy` พลังงาน · `society` สังคม. Finer topics go in tags. |
| LLM | omniroute (OpenAI-compatible `/v1/chat/completions`) with `cc/` + `cx/` models per task; see `.env` (`LLM_MODEL_*`, cross-vendor fallback, `LLM_OMIT_TEMPERATURE_FOR`, daily request/token caps). Config reads `OMNI_API_URL`/`OMNI_API_KEY` as `LLM_BASE_URL`/`LLM_API_KEY`. Mock provider for tests. |
| Deploy | `https://worldview.nared-fu.com` · Docker Compose services `app` (port 3000, no published port) + `cloudflared` (token tunnel `worldview`, pinned image version) · Cloudflare Access on `/admin*`. Tunnel + DNS route already created. |
| Academy | **Full Thai content for all 30 lessons** (7/7/7/9), drafted by agent; unverifiable references marked `TODO: verify`, never invented URLs. |
| Data | Demo/mock news fixtures clearly labeled as fictional until real ingestion exists (`DemoNotice`). |

### Academy lesson file contract (shared by content + app)

Path: `content/academy/week-{W}/day-{DD}-{slug}.md` — `day` is global 1–30.

```yaml
---
id: "w1-d01"            # stable
week: 1
day: 1
slug: "world-wars-overview"
title: "…"              # Thai
summary: "…"            # 1–2 sentences Thai
learning_objectives: ["…"]
glossary: [{ term: "NATO", term_th: "…", definition: "…" }]
key_questions: ["…"]
further_reading: [{ title: "…", publisher: "…", url: "…" | null, note: "TODO: verify" }]
related_tags: ["nato", "cold-war"]   # kebab-case English
related_categories: ["geopolitics"]  # from the 5 slugs
last_reviewed_at: "2026-11-13"
---
(markdown body, Thai, with ## headings for in-page TOC)
```

---

## 2. Waves

### Wave 0 — Foundation (parallel where files don't overlap)

| Step | Agent | Scope (files it may touch) | Output |
|---|---|---|---|
| 0.1 | `software-eng` | `docs/ARCHITECTURE.md`, `src/lib/types/**` | Contracts: domain types, repository interfaces, `LLMProvider`, `NewsSourceAdapter`, job/idempotency contract, route + load map, module boundaries, config/env contract |
| 0.2 | `backend` | everything for tooling scaffold **except** `src/lib/types/**`, `docs/**`, `content/**` | SvelteKit + TS strict + Tailwind + adapter-node + Drizzle config + Vitest + Playwright + ESLint/Prettier, `.env.example`, `/health`, npm scripts |
| 0.C | `general-purpose` (content) | `content/academy/**` | 30 full Thai lessons per contract above (runs through Wave 1) |
| 0.3 | `backend` | `src/lib/server/db/**`, `migrations/**`, `scripts/seed*`, fixtures | Drizzle schema (12 tables, PRD §7), migrations, seed fixtures, FTS5 tables — after 0.1 + 0.2 |

Orchestrator verifies Wave 0 (`npm run dev`, `npm test`, `db:migrate`, `db:seed`) before Wave 1.

### Wave 1 — Parallel lanes

| Agent | Scope | Work |
|---|---|---|
| `frontend` | `src/routes/**/+page.svelte`, `+layout.svelte`, `src/lib/components/**`, `src/app.css`, `src/lib/styles/**` | shadcn-svelte init + token mapping, AppShell (sidebar/bottom nav), ThemeToggle, all MVP pages from prototype against seeded data, a11y, states (loading/empty/error/stale/demo) |
| `backend` #1 News & Jobs | `src/lib/server/news/**`, `src/lib/server/jobs/**`, `scripts/**` | Source registry, RSS adapter + fixture feeds, normalize/UTC, canonical URL + fingerprint dedup, grouping, idempotent `job_runs`, backoff, SSRF allowlist, CLI jobs |
| `backend` #2 LLM & Editorial | `src/lib/server/llm/**`, `src/lib/server/editorial/**` | OpenAI-compatible provider + mock, per-task model routing, fallback, param omission, caps, cache (hash input+model+prompt version), Zod schemas, prompt separation, publishing gates |

### Wave 2 — Integration

**Decisions carried from Wave 1 (orchestrator, 2026-11-13):**
- Grouping vs tagging: **option (a)**. Ingest keeps the rule-based grouping (acceptance #3/#4 stay where they are). Digest tags articles `WHERE taxonomy IS NULL` whether they are grouped or not, and the LLM clustering task is used only for *ambiguous* matches (score 0.3–0.6). ARCHITECTURE §9 is updated to match.
- Shared helpers are moved into `#lib/utils/`. Wave 1 put temporary copies in lanes, so these move: `canonicalizeUrl`, `parseFeedTimestamp`, `withRetry`/`backoffDelayMs`, `hourSlot`. The missing §7 date helpers are added (`isBriefDate`, `isYearMonth`, `monthOf`, `addDays`, `bangkokDateTimeToUtc`, `formatThaiDate`, `formatThaiTime`), and the copies in `components/format.ts` are replaced.
- `listMatchableEvents` gets an `asc(events.id)` tie-break so grouping is deterministic.
- `sources` gets ETag/Last-Modified columns so conditional GET can be used.
- Production ingest fails until the owner approves at least one real source (PRD §12). The 6 candidate feeds are `enabled: false`.

| Agent | Work |
|---|---|
| `backend` | Brief jobs (morning/evening), archive snapshot, ranking + `selection_reason` + region quota, related events / lesson links with evidence, FTS search, admin API + Cloudflare Access JWT check, `content_revisions` (owns `+page.server.ts` / `+server.ts`) |
| `frontend` | Admin UI, search UI, failure/stale states, AI-assisted disclosure (owns `+page.svelte`) |
| `data-scientist` (optional) | Tune clustering thresholds / editorial relevance on fixtures; Thai summary model bake-off |

### Wave 3 — Verification
`qa-tester` (tests for PRD §11 acceptance 1–12; Playwright 360/390/430/768/1024/1440, both themes) · `tester` (build/lint/test + minimal fixes) · `reviewer` + `/security-review` (secrets in bundle, XSS/markdown, SSRF, admin auth, prompt injection) · `code-reviewer` (over-engineering) · `debugger` on demand.

### Wave 4 — Ops & deploy
`implementer`: Dockerfile, `docker-compose.yml` (`app` + pinned `cloudflared`), host scheduling for jobs, README (local setup, cron, backup/restore), Lighthouse/bundle/RAM baseline. Orchestrator brings it up and verifies `https://worldview.nared-fu.com`.

---

## 3. Logging rules (every agent run)

1. Orchestrator adds a row to `docs/AGENT_LOG.md` **before** launching (status `running`) and updates it when the agent returns.
2. Each agent writes its own file `docs/agent-logs/{YYYYMMDD-HHMM}_{wave}_{agent}_{task}.md` using the template in `docs/agent-logs/README.md`: start/end time (Asia/Bangkok), goal, steps taken, files changed, commands + results, **every error/failure with where it happened and how it was resolved (or not)**, open issues.
3. Times come from: `node -e "console.log(new Date().toLocaleString('sv-SE',{timeZone:'Asia/Bangkok'}))"`.
4. Orchestrator's own verification failures are logged too.
5. Logs never contain secrets (tokens, API keys, `.env` values).

## 4. Acceptance test owners (PRD §11)

| # | Topic | Owner |
|---|---|---|
| 1 | Mobile 375/1440, no overflow | frontend → qa-tester |
| 2 | 30 lessons reachable | content + frontend |
| 3–5 | Grouping, idempotency, timezone | backend #1 |
| 6 | Morning/evening brief + `/brief/YYYY-MM-DD` | backend (Wave 2) |
| 7–8 | Citations, relation evidence | backend #2 + reviewer |
| 9 | Works when LLM/provider down | backend #2 + qa-tester |
| 10 | Security | reviewer + security-review |
| 11–12 | Ops, performance baseline | backend + implementer |

## 5. Git workflow

- **Wave 0 (foundation)** → committed and pushed directly to `main` once verified.
- **After Wave 0**: every feature on its own branch, merged to `main` only through a Pull Request.
  - Branch names: `feature/<area>-<short-desc>`, `fix/…`, `chore/…`, `docs/…` (e.g. `feature/ui-app-shell`, `feature/news-ingestion`, `feature/llm-provider`).
  - Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
  - Parallel agents each work in their own **git worktree** on their own branch, created manually with `git worktree add -b feature/<name> C:\Project\WORLDVIEW-worktrees\<name> main` (the built-in `isolation: "worktree"` fails on this machine because of `c:` vs `C:` drive-letter case). Agents get the explicit path and must not edit other checkouts.
  - Before opening a PR: `npm run check && npm run lint && npm test && npm run build` pass, plus an independent `reviewer` pass; staged files scanned for secrets.
  - Orchestrator pushes the branch and opens the PR with `gh pr create` (summary, changes, test evidence, link to the agent log). **The owner reviews and merges on GitHub.**
  - After merge: delete the branch, pull `main`, rebase any still-open branches onto `main`.
- Branch/PR/merge events are recorded in `docs/AGENT_LOG.md`.

# Performance baseline — PRD §11 #12

This is a measurement only. PRD §11 #12 says to set a baseline before fixing any targets, so no
targets are set here. Each number below records the machine, the build and the method, so you
can repeat the measurement and compare.

## Conditions

| | |
|---|---|
| Date | 2026-11-13, 14:29–14:58 ICT |
| Code | `test/acceptance-suite` @ `7d59bd1`. Product code is identical to `main` @ `e074515` |
| Machine | AMD Ryzen 5 5600GT (6 cores / 12 threads), 31.3 GB RAM, Windows 11 Home build 26300, local NVMe |
| Runtime | Node 24.19.0, Vite 8, SvelteKit 3 with `@sveltejs/adapter-node` |
| Server | `npm run build`, then `npx vite preview --port 5373` (the production build) on `data/worldview.db` after `npm run db:reset`: seeded demo data, no ingest, so the site is in its stale/demo state |
| Browser (Lighthouse) | Google Chrome 157.0.8103.40, new headless mode, launched by Lighthouse's chrome-launcher (`CHROME_PATH`) |
| Load | Nothing else heavy was running. The other agents' servers on 4173/4273 may have been up |

These are local numbers: localhost, with no TLS, no Cloudflare and no real network. Lighthouse's
simulated throttling stands in for the mobile network. Production behind Cloudflare Tunnel will
differ.

## 1. Lighthouse (mobile preset)

Lighthouse 12.8.2 with its default settings: `formFactor: mobile`, a 412×823 screen at DPR 1.75,
`throttlingMethod: simulate` (150 ms RTT, 1.6 Mbps, CPU 4×). Each URL ran 3 times. The table shows
the **median**, with all three runs in brackets. Benchmark index 3008.

```bash
CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" \
  npx --yes lighthouse@12.8.2 http://localhost:5373/ --quiet --output=json \
  --output-path=lh.json --chrome-flags="--headless=new"
```

| URL | Performance | Accessibility | Best practices | SEO | LCP | FCP | CLS | TBT | Transfer |
|---|---|---|---|---|---|---|---|---|---|
| `/` | **95** [95/95/95] | 100 | 96 | 100 | 2.43 s | 2.43 s | 0.011 | 0 ms | 184 KB |
| `/academy/week/1/day/1` | **95** [95/95/95] | 96 | 100 | 100 | 2.42 s | 2.42 s | 0.007 | 0 ms | 186 KB |
| `/archive` | **88** [88/88/88] | 96 | 96 | 100 | 2.27 s | 2.27 s | **0.175** | 0 ms | 178 KB |
| `/events/demo-evt-01` | **96** [96/96/94] | 96 | 96 | 100 | 2.27 s | 2.27 s | 0.001 | 0 ms [0/0/10] | 178 KB |

What lost points:

- **Performance**:
  - LCP equals FCP on every page: SSR paints the content in one go.
  - All four pages have the same render-blocking resource, the single CSS file
    `0.*.css` (10 KB gzip, about 450 ms of estimated savings).
  - `/archive` loses its points to CLS 0.175, one shift of `main > div.grid` (**BUG-QA-010**).
    Without throttling CLS is 0.000–0.001. With CDP slow-4G and 4× CPU it reproduces at 0.32, as
    two shifts at about 2.5 s and 2.8 s. The final layout is identical with and without JS, so
    the shift is transient during load. The likely cause is the late Noto Sans Thai font swap
    re-wrapping the date-form row; this is not confirmed.
- **Accessibility**: 96 means the same axe findings as `BUGS.md`. `color-contrast` (BUG-QA-002 and
  003) on the lesson and archive pages, and `definition-list` (BUG-QA-004) on the event page.
- **Best practices**: 96 is the `font-size` audit, which Lighthouse 12 counts under best
  practices. Only 54.7 % (`/`), 46.0 % (`/archive`) and 46.9 % (event) of the text is 12 px or
  larger; Lighthouse passes at 60 %. 10–11 px labels are used widely (**BUG-QA-009**). The lesson
  page passes.
- **SEO**: 100 on all four.

The repro tests are in `tests/e2e/lighthouse-findings.e2e.ts`: `test.fixme` for BUG-QA-009 and
BUG-QA-010.

## 2. Production build size

`npm run build` takes 10.2 s wall time. Sizes are of `build/client` and exclude the precompressed
`.gz`/`.br` copies. Gzip is Node `zlib.gzipSync`, level 6.

| Asset | Files | Raw | Gzip |
|---|---|---|---|
| JavaScript | 47 | 366.0 KB | **132.4 KB** |
| CSS | 1 | 48.5 KB | **9.7 KB** |
| Fonts (`woff2` + `woff`, Noto Sans Thai subsets) | 18 | 169.7 KB | (already compressed) |
| All client files | 68 | 584.2 KB | — |
| Whole `build/` directory (client + server + precompressed copies) | — | 5.8 MB | — |

Largest JS chunks (raw / gzip):

| Chunk | Raw | Gzip |
|---|---|---|
| `nodes/0.*.js` (root layout and shell) | 64.8 KB | 21.3 KB |
| `chunks/Benb6lgt.js` | 55.5 KB | 21.0 KB |
| `chunks/BeRHMIE8.js` | 41.1 KB | 15.0 KB |
| `chunks/DwAvwxuz.js` | 65.8 KB | 14.8 KB |
| `nodes/3.*.js` | 10.8 KB | 4.2 KB |
| `nodes/8.*.js` | 10.7 KB | 4.0 KB |

Lighthouse measured a total transfer per page of 178–186 KB, including fonts.

## 3. Jobs: runtime and memory

`duration_ms` and `rss_bytes` come from the runner's `job finished` log line
(`src/lib/server/jobs/runner.ts`). RSS there is the process RSS **at the end of the job**. Peak RSS
is `process.resourceUsage().maxRSS` of the whole pipeline process. Each run started from a fresh
`npm run db:reset` of `data/qa-scratch.db`. "Wall" includes npm, tsx start-up and TypeScript
transpiling.

### Fixture ingest via the CLI: `npm run job -- ingest --fixtures` (3 runs)

| Run | Job `duration_ms` | RSS at end | Wall | Per-source fetch (`fetch_duration_ms`: a / b / c) |
|---|---|---|---|---|
| 1 | 41 | 236.2 MB | 1328 ms | 13 / 16 / 18 |
| 2 | 38 | 218.7 MB | 1223 ms | 11 / 13 / 16 |
| 3 | 39 | 254.2 MB | 1236 ms | 11 / 13 / 16 |

Each run: 9 items fetched, 2 dropped (bad links), 6 inserted, 1 URL duplicate, 4 events.

### Fixture pipeline with the mock LLM: `npx tsx tests/pipeline/run-fixture-pipeline.ts` (3 runs)

| Step | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| ingest (fixtures) | 59 ms | 60 ms | 67 ms |
| **digest (mock LLM)**: 4 events published, 4 lesson links, 0 LLM tokens | **40 ms** | **44 ms** | **42 ms** |
| brief_morning / brief_evening / archive_snapshot | 4 / 3 / 4 ms | 4 / 3 / 3 ms | 4 / 3 / 4 ms |
| empty-day brief (partial) | 2 ms | 2 ms | 2 ms |
| forced rerun: ingest / digest (0 new rows) | 14 / 2 ms | 15 / 2 ms | 16 / 2 ms |
| RSS at the end of each job | 207–210 MB | 207–210 MB | 207–209 MB |
| **Peak RSS of the process** | **232.1 MB** | **232.1 MB** | **231.2 MB** |
| Wall | 1520 ms | 1527 ms | 1555 ms |

### Real feeds (network): one run

These runs show what the fixture numbers cannot: real RSS fetch times.

| Command | Result |
|---|---|
| `npm run job -- ingest --dry-run`: no database writes | 4 sources OK, 133 items fetched, 18 dropped; RSS at end 220.9 MB; wall 1458 ms |
| `npm run job -- ingest` into the scratch DB | `duration_ms` **548**, RSS at end 250.1 MB; 115 articles, 113 events created |
| Per-source `fetch_duration_ms` | aljazeera-all **92**, guardian-world **118**, bbc-world **154**, un-news **289** |

### Reading the job numbers

- The time is start-up, not work. A job body takes 40–550 ms; most of the wall time is Node + tsx
  start-up (about 1.1 s).
- Memory is mostly the runtime. RSS is about 210–255 MB even for the 9-item fixture run: Node 24
  plus tsx/esbuild transpiling in-process. Of the 2 GB VPS planning target (PRD §6.2), that
  leaves the web server and SQLite most of the memory. A precompiled worker (no tsx at runtime)
  would be the first lever if RAM gets tight. This is a note, not a target.
- The mock digest does no real LLM work, so its runtime is a floor. Digest time with the real LLM
  is dominated by LLM latency. Track it with `llm_calls` and the `job finished` line in production.
- Real ingest created 113 events from 115 articles. Ingest-time grouping is deliberately strict;
  LLM clustering in the digest merges later (ARCHITECTURE §9). This matches the open item about
  grouping quality in the Wave 2.5 log.

## After the Wave 3 fixes

Re-measured on 2026-11-13 at about 15:30 ICT, on the same machine, with the same method as §1
(Lighthouse 12.8.2 mobile preset, installed Chrome 157 via `CHROME_PATH`, `npm run build` then
`npx vite preview --port 5373` on the seeded `data/worldview.db`, 3 runs per URL, median shown,
all three runs in brackets). Code: `fix/qa-wave3` @ `ab6ea7d`.

| URL | Performance | Accessibility | Best practices | SEO | LCP | FCP | CLS | TBT | Transfer | Legible text (`font-size`) |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` before | 95 [95/95/95] | 100 | 96 | 100 | 2.43 s | 2.43 s | 0.011 | 0 ms | 184 KB | 54.7 % (fail) |
| `/` **after** | **94** [94/95/94] | 100 | **100** | 100 | 2.43 s | 2.16 s | **0.000** | 138 ms [141/0/138] | 184 KB | **98.1 %** |
| `/archive` before | 88 [88/88/88] | 96 | 96 | 100 | 2.27 s | 2.27 s | 0.175 | 0 ms | 178 KB | 46.0 % (fail) |
| `/archive` **after** | **97** [97/96/97] | **100** | **100** | 100 | 2.33 s | 2.00 s | **0.000** | 26 ms [26/0/30] | 178 KB | **98.6 %** |

- `/archive` CLS 0.175 → 0.000 (BUG-QA-010) brings performance from 88 to 97. Accessibility is
  100 because the axe findings (BUG-QA-002/003) are fixed, and best practices is 100 because the
  `font-size` audit now passes (BUG-QA-009).
- `/` performance is 94–95, within run-to-run noise of the baseline. Two of its three runs
  recorded 138–141 ms of TBT; the third recorded 0 ms. LCP is unchanged.
- FCP is 0.3–0.4 s earlier on both pages. With `font-display: optional` (`src/lib/styles/fonts.css`),
  text paints immediately in the fallback font if Noto Sans Thai is not ready yet, instead of
  waiting for the swap.
- Transfer sizes are unchanged. The four preloaded font files (about 39 KB) were already part of
  every page load.

Throttled CLS from `tests/e2e/lighthouse-findings.e2e.ts` (412 px, CDP slow 4G, 4× CPU), with
layout-shift attribution:

| `/archive` | Shifts | CLS |
|---|---|---|
| Before | `main > div.grid` down 56 px at about 3.2 s (Latin subset loaded, Thai not yet: the date-form row wraps), then back up at about 3.4 s (Thai subset loaded) | 0.307 |
| Preload only (`c67cec8`) | Isolated run: one 0.001 shift. Full parallel e2e run: still 0.309 | 0.001 / 0.309 |
| Preload + `font-display: optional` (`ab6ea7d`) | None, in 2 sequential and 4 parallel runs, and in the full e2e run | **0.000** |

With `ab6ea7d` the same measure gives 0.000 on `/` (0.009 with preload only) and 0.000 on
`/events/demo-evt-01`.

## How to repeat

```bash
npm run build && npx vite preview --port 5373 --strictPort &            # then Lighthouse as above
node -e "…gzip sizes of build/client…"                                   # or any gzip -c | wc -c
DATABASE_URL=file:./data/qa-scratch.db npm run db:reset
DATABASE_URL=file:./data/qa-scratch.db npm run job -- ingest --fixtures   # look for "job finished"
DATABASE_URL=file:./data/qa-scratch.db npx tsx tests/pipeline/run-fixture-pipeline.ts  # pipeline_summary
```

The installed Google Chrome was needed. On this machine, Playwright's own `chrome.exe` (build
1254) crashes on launch (0xC0E90002), and Lighthouse hangs when attached to the Playwright
headless shell (see the Wave 3 QA agent log).

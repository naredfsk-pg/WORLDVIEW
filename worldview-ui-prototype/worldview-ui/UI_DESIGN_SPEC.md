# Worldview — UI/UX Design Specification & Claude Code Handoff

**Version:** UI Prototype v1.0 · 2026-11-13  
**Product:** Worldview — Understand the world, one connection at a time.  
**Primary target:** Responsive Web, **mobile-first**. Thai interface; preserve proper nouns and source names in original language.

## 1. What is delivered

- `index.html`: **self-contained interactive UI reference** (vanilla HTML/CSS/JS; no npm, CDN, images, or backend required). Open directly in a modern browser.
- `preview-*.png`: screenshots if included; reference only.
- `WORLDVIEW_PROJECT_REQUIREMENTS.md`: source product requirements (copied from prior project artifact).
- `README.md`: open instructions and prototype limitations.

The prototype is a **visual/interaction handoff**, not the production application. It intentionally uses **hypothetical demo news** from 10–13 November 2026, with explicit UI notices. Do not treat these as verified headlines, do not publish as live news, and do not remove the notices until the news ingestion and verification pipeline has been integrated.

## 2. Product experience

**Intent:** A calm, readable companion for understanding the world. News becomes easier to understand when it is connected to historical, economic, technological, and geopolitical background.

**UI principles:**

1. **Reading before decoration.** One clear hierarchy per screen, restrained iconography, no distracting motion, no flashing indicators.
2. **Clarity over density.** The first screen shows a hero explainer, 3–6 digestible article cards, and concise supporting context. Avoid long scrolls of dozens of cards.
3. **Mobile-first.** The highest-priority path (Today → Event detail → Academy/background) must work with one hand at 360–430px widths.
4. **Consistent context.** Show category, date, time zone, impact/explanation, link to sources, and related lessons where available.
5. **Source transparency.** Indicate confidence/uncertainty when needed; never silently invent attribution, causal claims, or citations.
6. **Accessible by default.** Sufficient contrast, 44px-ish touch surfaces, visible focus states, semantic controls, keyboard support, reduced-motion support.
7. **Dark/light parity.** No layout or content differences between themes; semantic tokens only.

## 3. Site map and suggested routes

| Prototype tab | Production route | Job |
|---|---|---|
| วันนี้ / Today | `/` or `/brief` | Current digest, categories, top story, today's other events |
| เรียนรู้ / Academy | `/academy` | 4-week / 30-day curriculum; per-day lesson details |
| ย้อนหลัง / Archive | `/archive`, `/brief/[date]` | Choose dates and categories; browse prior brief/events |
| เชื่อมโยง / Connections | `/connections` | Related events, causal caveats, time-spanning knowledge context |
| Event detail (modal in demo) | `/events/[id]` | Facts, significance, background, uncertain points, source references |
| Lesson detail (side panel in demo) | `/academy/week/[week]/day/[day]` | Markdown/MDX lesson content, learning objectives, glossary, quiz |
| Search modal | `/search` or dialog | Unified keyword search across articles/events and lessons |

Production **must** support URLs, browser back/forward, shareable event/lesson deep links, SEO metadata. The demo uses hash navigation only to run from a local `file://` without a dev server.

## 4. Layout specification

### Desktop (>= 901px)

- Fixed/sticky **235px left sidebar** with brand, 4 primary destinations, and small learning-progress module.
- Header across content with current section and theme/search utilities.
- Content region with generous whitespace (`42px` horizontal gutters in reference); typography remains reasonably sized and not stretched to edges.
- Today: primary story column + contextual right rail (roughly 290px).
- Academy: four week selector cards; lesson list + preview rail.
- Archive: calendar rail + dated results.
- Connections: visualization + detail rail.

### Tablet (721–900px)

- Hide sidebar and show fixed **4-item bottom navigation**; retain context rails only where they fit.
- Header shows compact brand + search/theme controls.
- Provide bottom padding so fixed nav never obstructs content.

### Mobile (<= 720px)

- Single-column articles, calendar then results, academy lessons then details.
- Persistent bottom nav: **วันนี้ · เรียนรู้ · ย้อนหลัง · เชื่อมโยง**.
- `18–25px` page gutters, `13–15px` body text, compact but legible headline hierarchy.
- Rounded story cards and readable vertical rhythm; avoid horizontal overflow.
- On smaller mobile (<=430px), narrow side panels collapse, headline scales down, featured globe becomes a subtle background.
- Sticky header is optional, but if used it must not compete with native browser space.

### Important interaction states

- Filter chips use `aria-pressed`; one active category at a time; default "ทั้งหมด".
- Theme button toggles Light/Dark, remembers user preference in localStorage, and initially honors `prefers-color-scheme`.
- Lesson cards can be marked complete; demo persists completion state in localStorage.
- Archive dates preserve timezone **Asia/Bangkok**, display only days available, and have empty-state copy.
- Event cards open accessible dialog in demo; production should prefer canonical event URL and native shareability.
- Connection nodes can be selected; side panel explains **why** the connection exists.
- Search button / keyboard `/` opens basic search dialog (demo local search only).
- Native `<dialog>` handles Esc to close; clicking outside also closes.

## 5. Visual identity and design tokens

Overall language: **calm editorial + modern intelligence interface**. Avoid bright neon, aggressive breaking-news red, glassmorphism, heavy gradients, excessive badges, or big dashboard KPIs.

### Semantic colors

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F8F5` | `#101917` | App canvas |
| `--surface` | `#FFFFFF` | `#192522` | Cards, sidebar, bottom nav |
| `--surface-2` | `#F1F4EF` | `#1D2C28` | Secondary controls, hover |
| `--text` | `#172622` | `#EBF2EE` | Primary reading text |
| `--muted` | `#65756F` | `#A6B5AE` | Explanatory text and metadata |
| `--faint` | `#89978F` | `#83968C` | Less prominent labels |
| `--stroke` | `#E3E9E3` | `#304039` | Borders, dividers |
| `--accent` | `#176653` | `#91D9B8` | Key actions, active nav, learning milestones |
| `--accent-subtle` | `#E4F2EB` | `#244239` | Active backgrounds |
| `--hero` | `#E9F2EB` | `#21372E` | Featured story |
| `--gold-bg` | `#FBF1DE` | `#3B3326` | Demo disclosure / caution copy |

Use **semantic tokens** in production: do not assign light-only or dark-only literal colors per component. Confirm WCAG contrast independently, especially secondary text, focus and category labels.

### Type

- Suggested production font: **Noto Sans Thai** (self-hosted/subset) or platform sans fallback (Tahoma, Segoe UI). Avoid heavy remote font dependencies for a lightweight deployment.
- Headline (`h1`): clamp 30–46px, bold, max ~2 lines.
- Section heading: 19–22px; card title 14–16px; reading body 14–16px with 1.7–1.9 line-height.
- Product UI labels: 10–12px, sparing use of all caps for English labels only.
- Longer lesson reading routes should use `max-width: 680–760px`, font ~16px and line-height ~1.9; do not replicate narrow card copy for lesson body.

### Spacing & shape

- Base 4px rhythm: 8/12/16/20/24/32/42.
- Corners: controls ~10–12px; cards ~15–17px; featured areas ~20px.
- Fine 1px separators; shadows faint, never floating everywhere.
- Icons: simple 18–20px line icons. Brand mark is a geometric globe (inline SVG, no raster asset).
- Respect safe-area bottom inset: `env(safe-area-inset-bottom)`.

## 6. Components for Claude Code to build

| Component name | Input | Responsibility |
|---|---|---|
| `AppShell.svelte` | route, progress | Desktop sidebar, header, mobile nav, main outlet |
| `ThemeToggle.svelte` | currentTheme | Light/Dark toggle, persistence, preferred theme |
| `PageIntro.svelte` | eyebrow, title, description | Consistent editorial page heading |
| `FilterChips.svelte` | categories, selected | Scrollable/mobile-safe filters with a11y |
| `FeaturedStory.svelte` | event | Hero explanation card (not necessarily an image) |
| `StoryCard.svelte` | event | Summary card with date, category, region |
| `EventDetail.svelte` | event, sources, relations | Factual summary, context, unknowns, sources; shareable route |
| `WeekCard.svelte` | week, progress | Academy selectors |
| `LessonCard.svelte` | lesson, completed | Day row with progress indicator |
| `LessonArticle.svelte` | lesson MD/MDX | Proper long-form reading layout, anchors, glossary, quiz |
| `ArchiveCalendar.svelte` | month, selected, availability | Select date, highlight available days |
| `ConnectionGraph.svelte` | nodes, edges | Draw links; fallback list on constrained devices |
| `ConnectionDetail.svelte` | selected edge/node | Show relationship type, evidence and reasoning |
| `EmptyState.svelte` | message | No results / provider down / content pending |
| `DemoNotice.svelte` | demoMode | Display accurate source status when in demo mode |

Suggested SvelteKit page structure:

```text
src/
  routes/
    +layout.svelte
    +page.svelte                 # Today
    academy/+page.svelte
    academy/week/[week]/day/[day]/+page.svelte
    archive/+page.svelte
    brief/[date]/+page.svelte
    events/[id]/+page.svelte
    connections/+page.svelte
    search/+page.svelte
  lib/
    components/
    stores/theme.ts
    data/demo.ts               # remove after backend integration
    types/worldview.ts
    styles/tokens.css
```

### Recommended SvelteKit stack

Follow the PRD: **SvelteKit + TypeScript + Tailwind CSS + SQLite/Drizzle + lightweight scheduled workers**. Frontend should not require separate Node services, a component mega-library, large map dependencies, or heavy animations. Prefer CSS + inline SVG. Lazy-load graph visualization only on `/connections` and consider a simple HTML event-relations list until Phase 2. Provider access (news source API keys / LLM endpoint keys) stays **server-side**.

## 7. Data contracts (UI-oriented)

```ts
type EventCategory =
  | 'ภูมิรัฐศาสตร์' | 'เศรษฐกิจ' | 'เทคโนโลยี'
  | 'พลังงาน' | 'สังคม';

type SourceRef = {
  source_name: string;
  title?: string;
  published_at: string; // UTC ISO 8601
  url: string;
};

type EventSummary = {
  id: string;
  title_th: string;
  summary_th: string;
  category: EventCategory;
  regions: string[];
  event_date: string; // Asia/Bangkok YYYY-MM-DD
  occurred_at?: string | null;
  last_updated_at: string; // UTC ISO 8601
  what_happened_th: string;
  why_it_matters_th: string;
  background_th?: string;
  uncertain_th?: string;
  sources: SourceRef[];
  related_lesson_ids: string[];
};

type EventRelation = {
  from_event_id: string;
  to_event_id: string;
  kind: 'follow_up' | 'background_of' | 'response_to' | 'same_topic' | 'potential_impact';
  rationale_th: string;
  evidence_source_urls: string[];
  reviewed: boolean;
};

type LessonSummary = {
  id: string;
  day_number: number;
  week_number: number;
  title_th: string;
  description_th: string;
  content_markdown: string;
};
```

### Event presentation rules

- Display the **event**, not each duplicate article separately.
- An event card opens an event detail route with cross-linked source articles.
- No source URL → not publishable as a verified current event.
- Distinguish `occurred_at`, `published_at`, `ingested_at`, and `updated_at`.
- Daily archive uses Asia/Bangkok calendar grouping and recorded snapshots.
- Relationships such as `potential_impact` must be visually and textually labeled as **possible**, not confirmed causal links.
- UI receives structured output from the backend; **never call the LLM endpoint directly from client JS**.

## 8. Screens and acceptance checklist

### Today

- [ ] Current date, last updated time, and explicit time zone.
- [ ] Featured top story and smaller summaries in clear reading order.
- [ ] All 5 main categories + All toggle; no layout jump.
- [ ] Each detail contains what happened, why it matters, background, uncertain points, and source links.
- [ ] Next link to related Academy lesson and to same event in prior days.
- [ ] No overclaim of live freshness when a source or scheduled job fails.

### Academy

- [ ] 4 weeks containing 30 individual lessons (7/7/7/9).
- [ ] Lesson preview and full lesson view available with no account required.
- [ ] Completion progress stored locally in MVP; data migration considered if accounts arrive later.
- [ ] Good Thai reading line length and line spacing.

### Archive

- [ ] Date picker and calendar synchronized.
- [ ] Only fetched/available dates have availability dot.
- [ ] Category filtering and empty-state copy.
- [ ] Daily snapshot and event updates remain historically understandable.

### Connections

- [ ] Node/edge click/tap shows linked events and a meaningful relationship explanation.
- [ ] Evidence URLs and relation type available for every production edge.
- [ ] Reachable and usable on mobile without pinch-to-zoom; include list fallback.
- [ ] Dynamic graph can be deferred to Phase 2.

### Themes/responsiveness/performance

- [ ] Both themes tested at 360, 390, 430, 768, 1024, 1440 widths.
- [ ] No horizontal scrolling; nav and dialogs do not cover primary actions.
- [ ] Contrast, keyboard, `prefers-reduced-motion`, responsive font, and accessible inputs.
- [ ] Server-rendered Today/Archive/Academy for quick first paint and SEO.
- [ ] Do not ship uncompressed article images or block rendering with third-party CDN scripts.
- [ ] Basic states: loading skeleton, error/retry, no-data, stale-data, unverified / pending review.

## 9. Backend + LLM boundary (pending details)

**Intentionally not specified yet:** LLM model name, endpoint, authentication method, request schema, timeout, batching/concurrency, inference budget. The owner will provide those details later. Leave the following configuration keys as placeholders:

```env
LLM_BASE_URL=
LLM_MODEL_ID=
LLM_API_KEY=
LLM_REQUEST_TIMEOUT_MS=30000
NEWS_PROVIDER_KIND=
NEWS_PROVIDER_API_KEY=
TZ=Asia/Bangkok
```

Do not hardcode secrets in client files, bundle, screenshots, repositories, or logs. Processing should happen in background jobs; UI reads persisted structured results from the local database. Keep the UI available if the LLM provider is down.

## 10. Implementation instructions to paste into Claude Code

> Read `WORLDVIEW_PROJECT_REQUIREMENTS.md`, `UI_DESIGN_SPEC.md`, and inspect `index.html` as the **visual and interaction reference**. Build the production-ready frontend in SvelteKit, TypeScript, and Tailwind CSS while matching the prototype's visual hierarchy, Thai copy tone, responsive behavior, light/dark tokens, and page structure. Reuse the product and data constraints from the PRD. Do not copy the vanilla JS SPA unchanged; factor it into components and proper SvelteKit routes. Keep theme preference and lesson progress in browser storage in the MVP. For all news data use clearly labeled mock fixtures until a verifiable ingestion pipeline and backend API exist; never present simulated data as real news. Include loading, error and empty states. LLM model ID, endpoint, and authorization are intentionally pending; leave typed server-side interfaces and env placeholders rather than inventing settings. Add automated checks for responsive navigation, theme persistence, category filters, archive date selection, modal/route detail, and completion progress.

## 11. Design decisions still open

- Final name/brand ("Worldview" is a working name).
- Whether Academy progress will later sync between devices (requires user account and privacy decisions).
- When to graduate Event detail from modal to canonical event route (recommended before launch).
- Real-world availability of news sources and republishing rights.
- Provider-based LLM inference budget, schedule, inference quality checks and event-linking validation.
- Whether Connections requires a full force-directed graph or a curated narrative timeline; **prefer the latter on mobile if graph clarity suffers**.

# Worldview — Mobile-first UI Prototype

A self-contained, interactive **design reference** for the Worldview knowledge + daily news application. No install required.

## Open the prototype

1. Download and unzip `worldview-ui.zip`.
2. Open `index.html` in Chrome, Firefox, Safari, or Edge.
3. Use the sidebar (desktop) or bottom navigation (mobile) to switch between four screens.
4. Toggle the sun/moon button in the header to change themes.

This prototype runs from `file://` with zero dependencies and zero network calls. You can also preview it with `python3 -m http.server 8000` and open `http://localhost:8000` if preferred.

## Interactive features

- Today: category filters, featured story, event detail dialogs.
- Academy: four weeks / thirty lessons; per-lesson selection and local progress marking.
- Archive: date picker and calendar (sample dates 10–13 Nov 2026), category filters.
- Connections: interactive 5-node conceptual graph and relationship details.
- Global search: search button or `/` shortcut; local search through sample events and lessons.
- Light/Dark: uses system preference unless manually set, saved in localStorage.

## Important limitations

- Every headline and event is **fictional demo copy**. The site has no live feed and no verified news sources. Demo disclosures must stay visible until production APIs exist.
- The calendar includes only four sample days.
- Academy contains curriculum outlines, not the 30 fully written lessons.
- Connections are illustrative rather than verified factual causal relationships.
- No authentication, API, database, background cron, LLM provider, or real event source linking.
- The event detail UI is a modal for demo convenience; production should use canonical URLs.

## Claude Code handoff

Give Claude Code:

1. `WORLDVIEW_PROJECT_REQUIREMENTS.md` — full product requirements.
2. `UI_DESIGN_SPEC.md` — implementation-ready design contract.
3. `index.html` — exact look/interaction reference.

Tell it to port the visual system to **SvelteKit + TypeScript + Tailwind CSS** with route-based architecture and reusable components. Never paste LLM keys/endpoints into client-side code.

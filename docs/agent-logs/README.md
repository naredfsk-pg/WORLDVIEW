# Agent run logs

One file per agent run: `{YYYYMMDD-HHMM}_{wave}_{agent}_{task}.md` (start time, Asia/Bangkok).
Get the time with:

```bash
node -e "console.log(new Date().toLocaleString('sv-SE',{timeZone:'Asia/Bangkok'}))"
```

Never write secrets (tokens, API keys, `.env` values) into a log.

## Template

```markdown
# {wave} · {agent} · {task}

| Field | Value |
|---|---|
| Started | YYYY-MM-DD HH:MM:SS (Asia/Bangkok) |
| Finished | YYYY-MM-DD HH:MM:SS (Asia/Bangkok) |
| Status | done / partial / failed |
| Agent type | e.g. backend |

## Goal
What this run was asked to deliver.

## What I did (in order)
1. HH:MM — step, and how (tool/command/approach)
2. …

## Files created / changed
- `path` — what changed

## Commands run & results
| Time | Command | Result |
|---|---|---|

## Errors & problems
| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
(write "none" if none)

## Open issues / follow-ups for the orchestrator
- …
```

# Phase 6+7: Review, ship and metrics (merged, minimal)

Phases 6 and 7 were merged into one at the user's request and kept deliberately small.

## What's in

- **Diff tab** (`src/renderer/task/Review.tsx`, `src/main/review.ts`): commits `base..HEAD`, files with +/− counts from `--numstat`, the unified diff over `base...HEAD` (or one commit with `sha^!`), coloured by line kind.
- **Ship panel** on the Diff tab when the task is `ready_to_ship` or `pushed`:
  - The PR description comes from `pr.md` if it exists. Otherwise it is generated from the issue, the plan's steps, the research and the implementation notes. It is saved to `pr.md` when the field loses focus or when you copy it.
  - Separate buttons for Copy branch name, Copy PR description, Push branch (`git push -u`) and Force push (`--force-with-lease`, behind a confirm). The push output is shown in the panel. A successful push moves the task to `pushed`.
  - **Mark done** (behind a confirm) removes the worktree but keeps the branch, sets `done` and `closed_at`, writes `manifest.json` and commits the task repo.
- **Abandon** works for any task that isn't done. It ends live sessions, interrupts their stages, removes the worktree and returns the issue to Todo.
- **Send back to Code** already existed from Phase 5 (`feedback/code-round-N.md`).
- **Metrics** (`src/main/metrics.ts`):
  - **Usage:** the transcript parser reads assistant lines, dedupes by `message.id`, skips `<synthetic>`, and reads `subagents/*.jsonl` next to the main file. It is re-run on each Stop and SessionEnd and upserts per-message usage rows.
  - **Cost:** priced by exact model id or glob from the price table.
  - **Three clocks:**
    - agent active: UserPromptSubmit → Stop, subagent Stops ignored
    - waiting on you: last Stop → approval
    - wall clock
  - **Where it shows:**
    - a per-stage table on the task's Metrics tab
    - the global Metrics view: today's totals, then per project
    - the Done view, a list of finished tasks that opens each one
    - live totals for today in the status bar
- **Tests** (`src/main/metrics.test.ts`):
  - the fixture totals (736 main / 166 subagent output tokens)
  - skipping synthetic and junk lines
  - price glob matching
  - the **no-merge grep test** over `src/` and `resources/`

## Skipped (follow-ups)

- Line comments on the diff and the `review.md` findings panel
- Side-by-side diff and syntax highlighting
- Incremental-offset transcript reading: each ingest re-reads the whole file, which is fine at current sizes
- Charts and a tool-call timeline on the Metrics tab
- Push to a real `origin` was not exercised in a live run. The code path is a plain `git push`.

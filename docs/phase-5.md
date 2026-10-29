# Phase 5: Pipeline

Stages now advance only by my click. Approve snapshots the artifact and starts the next stage, Request changes sends feedback into the same session, Send back reopens an earlier stage and resets the ones after it, and Skip moves on. The reducer in `machine.ts` decides what is legal, and the buttons follow it.

## Acceptance checks

| Check | Result |
| --- | --- |
| `quickfix` end to end on the toy repo | ⚠️ Partly real. With real claude on YAN-1: Code reached awaiting approval. Request changes wrote `feedback/code-round-2.md`, and the **same session** (`--resume`, run kind `feedback`) revised `implementation.md` and came back to awaiting approval. Approve committed "Approve Code (round 2)" in the task-folder repo, ended the session, and ran Review's checks into `checks.txt` (2 passed) before Review started. I stopped the real run there, so Review's approval wasn't done live. The full loop, through ready to ship, is a unit test against FakePty. |
| `standard` with one reject and one send-back from Review to Code | ⚠️ Unit tests only: reject in the pipeline tests, and send-back in quickfix (Review → Code, round 2, then Review starts over in a new session). Not run with real claude. |
| Nothing advances without my click | ✅ A Stop with a ready artifact only moves the stage to awaiting approval. The next stage stays pending (unit test, and seen live). |
| The card follows along | ✅ Live: the card shows stage dots, a Needs-you border, and the round ("Code r2"). The sidebar shows Needs you 1 and a count on the project. |

Typecheck clean, 155 tests pass (26 new: 20 reducer, 6 pipeline), build succeeds.

## What's in place

- **`machine.ts`:** `reduce` and `legalActions`, plus `sendBackTargets`, pure as SPEC describes. It enforces the rules:
  - stages run in order;
  - approve only from awaiting approval;
  - reject bumps the round and resumes the same session;
  - send back bumps the target's round, and every later non-skipped stage goes back to pending with a fresh session and no approval;
  - skip;
  - restart, pushed, finish and abandon.
- **`pipeline.ts`:** turns database rows into machine state, runs an action through the reducer, then carries out the effects in order:
  1. end sessions, and wait for them to exit;
  2. save the new statuses, rounds and approval hashes (sha256);
  3. write `feedback/<stage>-round-N.md`;
  4. make one commit in the task-folder repo;
  5. queue the next stage.

  Channel: `pipeline:act`.
- **Sessions:**
  - `enqueue` with a feedback file: the stage prompt is re-sent with `{{feedbackFile}}` filled in, as a resume when the stage has a session.
  - `stopAndWait`.
  - Checks before a fresh start: `checks.ts`, with the project's `pre` overriding the template's. Output goes to `checks.txt`, and failures don't block. The button reads "Running checks" while they run, and Stop cancels them.
- **UI:**
  - **Header buttons:** Approve, Request changes, and Send back… (also offered once the task is ready to ship).
  - **Overflow menu:** Reopen session, Skip…, Stop/End session.
  - **Feedback dialog:** Write/Preview, a stage picker for Send back, and Ctrl+Enter to send.
  - **Stage rail:** a node opens its artifact in Files, and an amber dot means the artifact was modified since approval.
  - **Files:** an Approved / Modified since approval / Waiting tag on artifacts.
  - **Elsewhere:** stage dots on cards, a working Needs you view, Needs-you counts in the sidebar (view and per project), and OS notifications (awaiting approval, fence block, checks done) when the window isn't focused; clicking one opens the task.

## Deviations from SPEC.md

1. **Hook-driven transitions still run in `hooks.ts`** and launches in `sessions.ts`, as in Phase 4. The reducer models them too (`hook`, `slotFree`, `appRestart`), and its tests encode the same rules. The pipeline actions (approve, reject, send back, skip) go through the reducer.
2. **The `runChecks` effect is informational.** Sessions runs checks itself before any fresh start, so a manual Launch also runs them.
3. **Stages reset by Send back keep their round number,** and only the target's round goes up. They do get a fresh session.
4. **The template loader and prompts came forward** in Phases 3 and 4, so nothing was left of that bullet here.
5. **The stage buttons stay in the header** (where Phase 4 put Start/Resume) rather than on the status line in SPEC's mock-up.
6. **OS notifications only fire while the window is unfocused,** since the in-app toast already covers the focused case.
7. **"Approve current stage" in the command palette** isn't done.

## Bugs found while verifying (fixed)

- **A resume that exited before SessionStart wiped the stage's session id:** for example, claude quit at the trust prompt. That lost the link to the conversation. It now stays interrupted and keeps the session, and a test covers it.

## Skipped / not tested

- **The live run stopped after Review's checks** (see above). Review's real turn, the real ready to ship, the real send-back, and a real `standard` run weren't done.
- **OS notifications** weren't seen (the window stayed focused).
- **The light theme** wasn't checked for the new dialog, card dots or Needs you view; they use the same tokens as the rest.

## Cleanup

The YAN-1 trust entry was added back to `~/.claude.json` for the live run and removed afterwards, with the toy-repo entry claude added. The test project's `pre` in the scratch config was set to two git commands.

// Help and the agent guide for the `yantra` CLI. Plain text, no imports: the client prints these without the app running.

export const HELP = `yantra: drive YANTRA from the terminal. The app starts in the background when needed.

Issues and tasks are named by key (PAY-12). The project is --project <slug>, else the one
whose repo contains the current folder, else the only one. Add --json to any command for JSON.

App
  status                         Live sessions, the queue and what needs you
  open [KEY]                     Show the window (and that task)
  quit                           Stop the background app (live sessions end)
  guide                          How an agent should use YANTRA (paste into CLAUDE.md)

Projects
  project list
  project add <repo-path> [--key PAY] [--name N] [--slug s] [--branch main] [--setup "npm ci; ..."]
  project remove <slug>
  templates                      Stage templates for task start

Issues
  issue list [--column todo] [--all]
  issue create <title> [-b body | --body-file f] [--column backlog|todo] [--priority high] [--label a,b]
  issue show KEY
  issue edit KEY [--title T] [-b body | --body-file f] [--priority p] [--label a,b]
  issue move KEY <backlog|todo|review|done>
  issue archive KEY [--undo]
  issue comment KEY <text>
  issue attach KEY <files...>
  label list | label set <name> [--color c] | label delete <name>

Tasks (the issue's live task)
  task start KEY [-t standard] [--no-launch]   Create the worktree and run the first stage
  task show KEY                  Stages, the last message and the next commands
  task wait KEY [--timeout 100]  Block until no stage is queued or running (exit 3 on timeout)
  task approve KEY               Approve the stage waiting on you; the next one starts
  task reject KEY -m "what to change"          Same stage, another round
  task send-back KEY <stage> -m "why"          Back to an earlier stage
  task skip KEY | task resume KEY | task stop KEY
  task screen KEY [--lines 40]   The stage terminal's last lines (is it stuck, what is it asking?)
  task type KEY <text> [--no-enter] | task type KEY --key esc|enter|up|down|tab|ctrl-c
  task files KEY | task cat KEY <path> | task add KEY <files...>
  task write KEY brief.md (--text T | --file f)
  task diff KEY [--stat] [--sha abc123]
  task pr KEY [--file f]         Print the PR description, or save pr.md from a file
  task push KEY [--force]        git push -u (force: --force-with-lease)
  task done KEY [--force]        Remove the worktree, keep the branch, write manifest.json
  task abandon KEY [--force]     End sessions, remove the worktree, issue back to Todo
  task metrics KEY

  metrics                        Today and per-project totals
`;

export const GUIDE = `# Managing work with YANTRA

YANTRA runs each task as a pipeline of Claude Code stages (for the standard template:
research -> plan -> code -> review) in its own git worktree and branch. Every stage stops for
approval. Use the \`yantra\` command for everything; the person can open the app at any time with
\`yantra open KEY\` to watch or take over.

Workflow for one piece of work:
1. \`yantra issue create "Title" --body-file issue.md --column todo --priority high\` (prints PAY-12).
2. \`yantra task start PAY-12\` creates the worktree and starts the first stage.
3. \`yantra task wait PAY-12\` blocks up to 100 s. Exit 3 means still running: run it again.
4. When a stage waits on you, read its artifact (\`yantra task cat PAY-12 plan.md\`; for code,
   \`yantra task diff PAY-12\`), then either \`yantra task approve PAY-12\` or
   \`yantra task reject PAY-12 -m "specific changes"\`. Approving starts the next stage.
5. If a stage is idle or interrupted, \`yantra task screen PAY-12\` shows what its session is
   asking; answer with \`yantra task type PAY-12 "answer"\`, or \`yantra task resume PAY-12\`.
6. When every stage is approved the task is ready to ship: review \`yantra task pr PAY-12\`,
   then \`yantra task push PAY-12\`. Never merge: the person merges the PR themselves, then runs
   or asks for \`yantra task done PAY-12\`.

Rules: do not edit the task's worktree yourself while its stages run; the stages do the work.
Keep at most the configured number of sessions running (\`yantra status\`). If something looks
stuck or needs a judgement call, stop and tell the person to run \`yantra open PAY-12\`.
`;

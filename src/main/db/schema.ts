// Migration 1: the full MVP schema from SPEC.md. Kept as a TS string so main needs no `?raw`
// loader or type shim, and vitest imports it as-is.
export const SCHEMA_V1 = /* sql */ `
-- Board -------------------------------------------------------------------
CREATE TABLE issue_seq (
  project_slug TEXT PRIMARY KEY,
  next_number  INTEGER NOT NULL
);

CREATE TABLE issue (
  id           INTEGER PRIMARY KEY,
  project_slug TEXT NOT NULL,
  number       INTEGER NOT NULL,           -- shown as <KEY>-<number>
  title        TEXT NOT NULL,
  body_md      TEXT NOT NULL DEFAULT '',
  column_key   TEXT NOT NULL,              -- backlog|todo|in_progress|review|done; ignored once a task exists
  priority     INTEGER NOT NULL DEFAULT 0, -- 0 none, 1 low, 2 medium, 3 high, 4 urgent
  position     REAL NOT NULL,              -- fractional index within its column
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE(project_slug, number)
);

CREATE TABLE label (
  id           INTEGER PRIMARY KEY,
  project_slug TEXT NOT NULL,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL,              -- palette name, not hex
  UNIQUE(project_slug, name)
);

CREATE TABLE issue_label (
  issue_id INTEGER NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES label(id) ON DELETE CASCADE,
  PRIMARY KEY(issue_id, label_id)
);

CREATE TABLE issue_comment (
  id         INTEGER PRIMARY KEY,
  issue_id   INTEGER NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  body_md    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE issue_attachment (
  id         INTEGER PRIMARY KEY,
  issue_id   INTEGER NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  file_name  TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Tasks and stages --------------------------------------------------------
CREATE TABLE task (
  id            INTEGER PRIMARY KEY,
  issue_id      INTEGER NOT NULL REFERENCES issue(id),
  project_slug  TEXT NOT NULL,
  issue_key     TEXT NOT NULL,
  title         TEXT NOT NULL,
  template      TEXT NOT NULL,
  template_yaml TEXT NOT NULL,
  status        TEXT NOT NULL,            -- draft|active|ready_to_ship|pushed|done|abandoned
  branch        TEXT NOT NULL,
  base_sha      TEXT,
  worktree_path TEXT NOT NULL,
  task_dir      TEXT NOT NULL,
  pushed_at     INTEGER,
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER
);
-- abandoned tasks stay as history; a new task can then be started on the same issue
CREATE UNIQUE INDEX one_live_task_per_issue ON task(issue_id) WHERE status <> 'abandoned';

CREATE TABLE stage (
  id             INTEGER PRIMARY KEY,
  task_id        INTEGER NOT NULL REFERENCES task(id),
  stage_key      TEXT NOT NULL,
  position       INTEGER NOT NULL,
  status         TEXT NOT NULL,           -- pending|queued|running|idle|awaiting_approval|approved|skipped|interrupted
  session_id     TEXT,
  round          INTEGER NOT NULL DEFAULT 1,
  approved_hash  TEXT,
  approved_at    INTEGER,
  awaiting_since INTEGER,
  UNIQUE(task_id, stage_key)
);

CREATE TABLE run (
  id             INTEGER PRIMARY KEY,
  stage_id       INTEGER NOT NULL REFERENCES stage(id),
  session_id     TEXT NOT NULL,
  kind           TEXT NOT NULL,           -- start|resume|feedback
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,
  exit_code      INTEGER,
  transcript     TEXT,
  claude_version TEXT
);

CREATE TABLE usage (
  message_id    TEXT PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES run(id),
  model         TEXT,
  input_tokens  INTEGER, output_tokens INTEGER,
  cache_read    INTEGER, cache_write   INTEGER,
  is_sidechain  INTEGER NOT NULL DEFAULT 0,
  ts            INTEGER
);

CREATE TABLE event (
  id         INTEGER PRIMARY KEY,
  run_id     INTEGER REFERENCES run(id),
  ts         INTEGER NOT NULL,
  hook       TEXT NOT NULL,
  tool       TEXT,
  summary    TEXT,
  blocked    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE review_comment (
  id         INTEGER PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES task(id),
  file       TEXT NOT NULL,
  line       INTEGER,
  side       TEXT,                        -- old|new
  body       TEXT NOT NULL,
  state      TEXT NOT NULL,               -- draft|sent_to_agent|resolved
  round      INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`;

// Migration 2 (Phase 3): when task creation finished all its steps. A draft with NULL here had a
// step fail (or the app quit mid-way), and the task tab offers to finish setup.
export const SCHEMA_V2 = /* sql */ `
ALTER TABLE task ADD COLUMN setup_done_at INTEGER;
`;

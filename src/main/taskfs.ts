// The task folder: content only, never state. Each one is its own local git repo (never pushed).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PRIORITY_LABEL, type IssueDetail, type LabelInfo } from '@shared/board';
import { FILE_ORDER, isEditable, type FileContent, type FileNode } from '@shared/tasks';
import { freeName } from './board';
import { gitError, runGit } from './git';

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/** issue.md: a snapshot of the local issue, rewritten by "Refresh from board", never edited by hand. */
export function renderIssueMd(issue: IssueDetail, labels: LabelInfo[], now = Date.now()): string {
  const names = issue.labelIds.map((id) => labels.find((l) => l.id === id)?.name).filter(Boolean);
  const lines = [
    `# ${issue.key}: ${issue.title}`,
    '',
    `> Snapshot of the board issue, taken ${iso(now)} UTC. "Refresh from board" rewrites this file, so edit the issue instead.`,
    '',
    `- **Key:** ${issue.key}`,
    `- **Priority:** ${PRIORITY_LABEL[issue.priority]}`,
    `- **Labels:** ${names.length ? names.join(', ') : 'none'}`,
    `- **Created:** ${iso(issue.createdAt)} UTC`,
    `- **Attachments:** ${issue.attachments.length ? issue.attachments.map((a) => `resources/${a.fileName}`).join(', ') : 'none'}`,
    '',
    '## Description',
    '',
    issue.body.trim() || '_No description._',
    '',
    '## Comments',
    '',
  ];
  if (!issue.comments.length) lines.push('_No comments._', '');
  for (const c of issue.comments) lines.push(`### ${iso(c.createdAt)} UTC`, '', c.body.trim(), '');
  return lines.join('\n');
}

/** brief.md as SPEC lays it out, with Goal prefilled from the issue body. Mine to edit from then on. */
export function renderBrief(issue: Pick<IssueDetail, 'key' | 'title' | 'body'>): string {
  return [
    `# ${issue.key}: ${issue.title}`,
    '',
    '## Goal',
    '',
    issue.body.trim() || '_What should be true when this is done?_',
    '',
    '## Must / must not',
    '',
    '## Acceptance criteria',
    '',
    '## Pointers (files, modules, people, links)',
    '',
    '## Notes',
    '',
  ].join('\n');
}

// The task repo commits as YANTRA, not as me, and never signs: it is local history, never pushed.
const COMMITTER = ['-c', 'user.name=YANTRA', '-c', 'user.email=yantra@localhost', '-c', 'commit.gpgsign=false'];

/** Commits everything in the task folder. A clean folder is fine (nothing to commit). */
export async function commitTaskRepo(dir: string, message: string): Promise<void> {
  const add = await runGit(dir, ['add', '-A']);
  if (!add.ok) throw new Error(gitError(add));
  const clean = await runGit(dir, ['diff', '--cached', '--quiet']);
  if (clean.ok) return;
  const r = await runGit(dir, [...COMMITTER, 'commit', '--quiet', '--no-verify', '-m', message]);
  if (!r.ok) throw new Error(gitError(r));
}

export interface FolderInput {
  dir: string;
  issueMd: string;
  briefMd: string;
  attachments: { path: string; fileName: string }[];
}

/**
 * Creates the task folder. Idempotent: an existing brief.md, issue.md or resource is kept as it
 * is, so retrying a half-finished start never overwrites what I already wrote.
 */
export async function ensureTaskFolder({ dir, issueMd, briefMd, attachments }: FolderInput): Promise<void> {
  for (const sub of ['resources', 'feedback', 'log']) mkdirSync(join(dir, sub), { recursive: true });
  const fresh = !existsSync(join(dir, '.git'));
  if (fresh) {
    const r = await runGit(dir, ['init', '--quiet']);
    if (!r.ok) throw new Error(`git init: ${gitError(r)}`);
  }
  const put = (name: string, text: string) => existsSync(join(dir, name)) || writeFileSync(join(dir, name), text);
  put('issue.md', issueMd);
  put('brief.md', briefMd);
  for (const a of attachments) {
    const to = join(dir, 'resources', a.fileName);
    if (!existsSync(to) && existsSync(a.path)) copyFileSync(a.path, to);
  }
  // git keeps no empty folders; these make the layout show up in a fresh clone of the history too.
  for (const sub of ['feedback', 'log']) put(join(sub, '.gitkeep'), '');
  await commitTaskRepo(dir, fresh ? 'Task created' : 'Task folder completed');
}

/** Resolves `rel` inside `dir`, refusing anything that escapes it or reaches into .git. */
export function safePath(dir: string, rel: string): string {
  if (!rel || isAbsolute(rel)) throw new Error('Not a path inside the task folder');
  const abs = resolve(dir, rel);
  const r = relative(dir, abs);
  if (!r || r.startsWith('..') || isAbsolute(r) || r.split(sep)[0] === '.git') throw new Error('Not a path inside the task folder');
  return abs;
}

const rank = (name: string) => {
  const i = FILE_ORDER.indexOf(name);
  return i < 0 ? FILE_ORDER.length : i;
};

const MAX_NODES = 2000;

/** The folder as a tree: dot-files hidden, known files in pipeline order, then folders, then the rest by name. */
export function listTree(dir: string): FileNode[] {
  let budget = MAX_NODES;
  const walk = (abs: string, rel: string, top: boolean): FileNode[] => {
    const entries = readdirSync(abs, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
    const nodes: FileNode[] = [];
    for (const e of entries) {
      if (budget-- <= 0) break;
      const childAbs = join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const st = statSync(childAbs);
      nodes.push(
        e.isDirectory()
          ? { path: childRel, name: e.name, kind: 'dir', size: 0, mtime: st.mtimeMs, children: walk(childAbs, childRel, false) }
          : { path: childRel, name: e.name, kind: 'file', size: st.size, mtime: st.mtimeMs },
      );
    }
    return nodes.sort(
      (a, b) =>
        (top ? rank(a.name) - rank(b.name) : 0) ||
        Number(b.kind === 'dir') - Number(a.kind === 'dir') ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    );
  };
  return existsSync(dir) ? walk(dir, '', true) : [];
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;

export function readTaskFile(dir: string, rel: string): FileContent {
  const abs = safePath(dir, rel);
  const st = statSync(abs);
  if (!st.isFile()) throw new Error(`${rel} is a folder`);
  const meta = { size: st.size, mtime: st.mtimeMs };
  const mime = IMAGE_TYPES[extname(abs).toLowerCase()];
  if (mime) {
    if (st.size > MAX_IMAGE) return { kind: 'too-large', ...meta };
    return { kind: 'image', dataUrl: `data:${mime};base64,${readFileSync(abs).toString('base64')}`, ...meta };
  }
  if (st.size > MAX_TEXT) return { kind: 'too-large', ...meta };
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8192).includes(0)) return { kind: 'binary', ...meta };
  return { kind: 'text', text: buf.toString('utf8').replace(/^﻿/, ''), ...meta };
}

/** Writes one of the files I may edit (brief.md). Artifacts belong to their stage. */
export function writeTaskFile(dir: string, rel: string, text: string): number {
  if (!isEditable(rel)) throw new Error(`${rel} isn't editable here`);
  const abs = safePath(dir, rel);
  writeFileSync(abs, text);
  return statSync(abs).mtimeMs;
}

/** Copies files into resources/, renaming on a clash ("notes (2).md"). Returns the names used. */
export function addResources(dir: string, paths: string[]): string[] {
  for (const p of paths) {
    if (!existsSync(p)) throw new Error(`File not found: ${p}`);
    if (!statSync(p).isFile()) throw new Error(`${basename(p)} is a folder; add the files inside it instead`);
  }
  const res = join(dir, 'resources');
  mkdirSync(res, { recursive: true });
  return paths.map((p) => {
    const name = freeName(res, basename(p));
    copyFileSync(p, join(res, name));
    return name;
  });
}

/** Deletes a file under resources/ (only there: everything else in the folder is history). */
export function removeResource(dir: string, rel: string): void {
  if (!rel.startsWith('resources/')) throw new Error('Only files in resources/ can be removed');
  const abs = safePath(dir, rel);
  if (!statSync(abs).isFile()) throw new Error(`${rel} is a folder`);
  rmSync(abs);
}

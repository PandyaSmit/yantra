// zod schemas for everything that crosses a boundary: config.json on disk and IPC payloads.
// Used by main (to validate) and the renderer (to show inline form errors).
import { z } from 'zod';
import { PALETTE } from './palette';

export const THEMES = ['system', 'light', 'dark'] as const;

const lines = z.array(z.string().trim().min(1));

export const ProjectSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Lowercase letters, digits and dashes, up to 40 characters'),
  name: z.string().trim().min(1, 'Give the project a name').max(60),
  key: z.string().regex(/^[A-Z]{2,5}$/, '2 to 5 uppercase letters, like PAY'),
  color: z.enum(PALETTE),
  repoPath: z.string().trim().min(1, 'Pick the repository folder'),
  defaultBranch: z.string().trim().min(1, 'Default branch is required'),
  remote: z.string().trim(), // empty when the repo has no remote
  sharedDirs: lines.default([]),
  worktreeSetup: lines.default([]),
  pre: lines.optional(), // overrides the template's pre-commands when set
});
export type Project = z.infer<typeof ProjectSchema>;

export const PriceSchema = z.object({
  in: z.number().nonnegative(),
  out: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
});
export type Price = z.infer<typeof PriceSchema>;
export const PriceTableSchema = z.record(z.string().min(1), PriceSchema);

export const GeneralSettingsSchema = z.object({
  claudeBinary: z.string().trim().min(1, 'Path to the claude binary'),
  maxConcurrentSessions: z.number().int().min(1, 'At least 1').max(8, 'At most 8'),
  defaultTemplate: z.string().trim().min(1),
  theme: z.enum(THEMES),
  dataRoot: z.string().trim().min(1, 'Pick a folder for YANTRA data'),
  trustWorktrees: z.boolean(),
});
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

export const AppConfigSchema = GeneralSettingsSchema.extend({
  version: z.literal(1),
  priceTable: PriceTableSchema,
  projects: z.array(ProjectSchema),
}).superRefine((cfg, ctx) => {
  const seen = { slug: new Set<string>(), key: new Set<string>() };
  cfg.projects.forEach((p, i) => {
    for (const field of ['slug', 'key'] as const) {
      if (seen[field].has(p[field])) {
        ctx.addIssue({ code: 'custom', path: ['projects', i, field], message: `Duplicate project ${field} "${p[field]}"` });
      }
      seen[field].add(p[field]);
    }
  });
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Flatten zod issues into { "path.to.field": "message" } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    out[key] ??= issue.message;
  }
  return out;
}

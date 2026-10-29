// Stage templates: YAML files, zod-validated. Shipped ones live in resources/templates; a file with
// the same name in <YANTRA_HOME>/templates replaces the shipped one. Loaded on every call, so an edit
// applies to the next task without a restart (running tasks keep their snapshot).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { TemplateSchema, type Template, type TemplateError, type TemplateInfo } from '@shared/tasks';

export interface LoadedTemplate {
  template: Template;
  /** The file's text, snapshotted into the task row. */
  yaml: string;
  file: string;
}

/** Parses and validates one template. Throws with a readable message. */
export function parseTemplate(text: string): Template {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new Error(`Not valid YAML: ${(e as Error).message.split('\n')[0]}`);
  }
  const r = TemplateSchema.safeParse(raw);
  if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join('.') || 'template'}: ${i.message}`).join('; '));
  return r.data;
}

/** Loads every *.yaml in `dirs`, later dirs overriding earlier ones by template name. */
export function loadTemplates(dirs: string[]): { templates: LoadedTemplate[]; errors: TemplateError[] } {
  const byName = new Map<string, LoadedTemplate>();
  const errors: TemplateError[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort()) {
      const file = join(dir, name);
      try {
        const yaml = readFileSync(file, 'utf8');
        const template = parseTemplate(yaml);
        byName.set(template.name, { template, yaml, file });
      } catch (e) {
        errors.push({ file: basename(file), message: e instanceof z.ZodError ? e.message : (e as Error).message });
      }
    }
  }
  return { templates: [...byName.values()], errors };
}

export const templateInfo = ({ template }: LoadedTemplate): TemplateInfo => ({
  name: template.name,
  description: template.description,
  stages: template.stages.map((s) => ({ key: s.key, title: s.title })),
});

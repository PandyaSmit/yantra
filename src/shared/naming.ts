// Pure helpers for suggesting a project's name, slug and issue key from its folder.

/** "payments-api" → "Payments Api", "yantra" → "Yantra"; words that already have capitals are kept. */
export function displayName(folder: string): string {
  const words = folder.split(/[-_\s]+/).filter(Boolean);
  return words.map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ') || folder;
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'project';
}

/**
 * Suggest a 2–5 letter issue key that isn't taken: "Payments API" → PAY, then initials (PA),
 * then longer prefixes (PAYM, PAYME), then the first two letters plus X/Y/Z….
 */
export function suggestKey(name: string, taken: Iterable<string> = []): string {
  const used = new Set([...taken].map((k) => k.toUpperCase()));
  const words = name
    .normalize('NFKD')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
  const letters = words.join('') || 'PRJ';
  const first = words[0] ?? letters;

  const candidates = [
    first.slice(0, 3),
    words.map((w) => w[0]).join('').slice(0, 5),
    first.slice(0, 4),
    letters.slice(0, 3),
    letters.slice(0, 4),
    letters.slice(0, 5),
    ...'XYZQWVK'.split('').map((c) => letters.slice(0, 2) + c),
  ];
  const valid = candidates.filter((c) => /^[A-Z]{2,5}$/.test(c));
  return valid.find((c) => !used.has(c)) ?? valid[0] ?? 'PRJ';
}

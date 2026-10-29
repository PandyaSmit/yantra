import { describe, expect, it } from 'vitest';
import { branchSlug, displayName, slugify, suggestKey, taskBranch } from './naming';

describe('displayName', () => {
  it('turns folder names into titles, keeping existing capitals', () => {
    expect(displayName('yantra')).toBe('Yantra');
    expect(displayName('payments-api')).toBe('Payments Api');
    expect(displayName('infra_tools')).toBe('Infra Tools');
    expect(displayName('Payments API')).toBe('Payments API');
    expect(displayName('myAPI')).toBe('myAPI');
  });
});

describe('slugify', () => {
  it('makes lowercase dash slugs', () => {
    expect(slugify('Payments API')).toBe('payments-api');
    expect(slugify('  infra_tools v2 ')).toBe('infra-tools-v2');
    expect(slugify('Café Ünïcode')).toBe('cafe-unicode');
  });
  it('never returns an empty slug', () => {
    expect(slugify('!!!')).toBe('project');
  });
  it('caps length at 40 without a trailing dash', () => {
    const s = slugify('a'.repeat(39) + ' b');
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('branchSlug / taskBranch', () => {
  it('kebab-cases the title and cuts long ones at a word boundary', () => {
    expect(taskBranch('PAY-12', 'Fix webhook retry storm!')).toBe('yantra/PAY-12-fix-webhook-retry-storm');
    expect(branchSlug('Make the export button work for every single report type we have')).toBe('make-the-export-button-work-for-every');
    expect(branchSlug('x'.repeat(60))).toHaveLength(40);
    expect(branchSlug('???')).toBe('task');
  });
});

describe('suggestKey', () => {
  it('takes the first three letters of the first word', () => {
    expect(suggestKey('Payments API')).toBe('PAY');
    expect(suggestKey('payments-api')).toBe('PAY');
    expect(suggestKey('infra')).toBe('INF');
  });
  it('falls back to initials, then longer prefixes, when taken', () => {
    expect(suggestKey('Payments API', ['PAY'])).toBe('PA');
    expect(suggestKey('Payments API', ['PAY', 'PA'])).toBe('PAYM');
    expect(suggestKey('infra', ['INF', 'INFR', 'INFRA'])).toBe('INX');
  });
  it('ignores digits and symbols, and is case-insensitive about taken keys', () => {
    expect(suggestKey('2fa-service')).toBe('FA');
    expect(suggestKey('2fa-service', ['fa'])).toBe('FS');
  });
  it('always returns 2 to 5 uppercase letters', () => {
    for (const name of ['x', '42', '', 'a b c d e f g', 'ß']) expect(suggestKey(name)).toMatch(/^[A-Z]{2,5}$/);
  });
});

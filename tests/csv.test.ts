import { describe, it, expect } from 'vitest';
import { parseIdeasCsv, generateSlug } from '../src/csv/parser.js';
import { convertGoogleSheetsUrl } from '../src/csv/sources.js';

describe('CSV Parser', () => {
  it('parses semicolon-delimited CSVs', () => {
    const semi = "Sl No;Idea;Agent Automatable\n1;EU Invoice Generator;YES\n";
    const ideas = parseIdeasCsv(semi);
    expect(ideas).toHaveLength(1);
    expect(ideas[0].slug).toBe('eu-invoice-generator');
  });
  it('parses tab-separated values (TSV)', () => {
    const tsv = "Sl No\tIdea\tAgent Automatable\n1\tDistributed Cache Service\tYES\n";
    const ideas = parseIdeasCsv(tsv);
    expect(ideas).toHaveLength(1);
    expect(ideas[0].slug).toBe('distributed-cache-service');
  });
  it('generates clean URL-safe slugs', () => {
    expect(generateSlug('Universal Fleet Controller! 24x7')).toBe('universal-fleet-controller-24x7');
    expect(generateSlug('Recipe Sharing App (Mobile & Web)')).toBe('recipe-sharing-app-mobile-web');
    expect(generateSlug('Café & Restaurant POS')).toBe('cafe-restaurant-pos');
  });

  it('parses valid CSV rows with various header names', () => {
    const csv = `Sl No,Idea,Agent Automatable
1,Recipe Sharing Platform,YES
2,Manual Hardware Assembly,NO
3,Expense Tracker,YES
`;
    const ideas = parseIdeasCsv(csv);
    expect(ideas).toHaveLength(2);
    expect(ideas[0].sl_no).toBe(1);
    expect(ideas[0].slug).toBe('recipe-sharing-platform');
    expect(ideas[1].sl_no).toBe(3);
    expect(ideas[1].slug).toBe('expense-tracker');
  });

  it('handles Google Sheets export URL conversion', () => {
    const editUrl = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?gid=123#gid=123';
    const converted = convertGoogleSheetsUrl(editUrl);
    expect(converted).toBe('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=123');
  });

  it('throws helpful errors on empty or non-CSV sources', () => {
    expect(() => parseIdeasCsv('')).toThrow('CSV source is empty');
    expect(() => parseIdeasCsv('<!DOCTYPE html><html><body>Error</body></html>')).toThrow('CSV source returned HTML');
    expect(() => parseIdeasCsv('Name,Age\nJohn,30')).toThrow('missing a serial-number column');
  });
});

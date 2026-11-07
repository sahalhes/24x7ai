import { parse } from 'csv-parse/sync';

export interface IdeaItem {
  sl_no: number;
  idea: string;
  slug: string;
  automatable: string;
  sourceRow: Record<string, string>;
}

export function generateSlug(idea: string): string {
  // Normalize unicode, lowercase, replace non-alphanumeric with hyphen
  let s = idea
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/, '');

  return s || 'project';
}

function getField(row: Record<string, string>, ...candidateNames: string[]): string {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key) {
      const cleanKey = key.trim().toLowerCase().replace(/[\s-]+/g, '_');
      normalized[cleanKey] = (value || '').trim();
    }
  }

  for (const name of candidateNames) {
    if (normalized[name]) {
      return normalized[name];
    }
  }
  return '';
}

export function parseIdeasCsv(csvContent: string): IdeaItem[] {
  if (!csvContent || !csvContent.trim()) {
    throw new Error('CSV source is empty.');
  }

  if (csvContent.trim().toLowerCase().startsWith('<!doctype') || csvContent.trim().toLowerCase().startsWith('<html')) {
    throw new Error('CSV source returned HTML. Use a direct CSV or Google Sheets export URL.');
  }

  const records = parse(csvContent, {
    columns: true,
    delimiter: (() => {
      const firstLine = csvContent.split('\n')[0] || '';
      if (firstLine.includes('\t') && !firstLine.includes(',')) return '\t';
      if (firstLine.includes(';') && !firstLine.includes(',')) return ';';
      return ',';
    })(),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    return [];
  }

  const first = records[0];
  const keys = Object.keys(first).map((k) => k.trim().toLowerCase().replace(/[\s-]+/g, '_'));

  const hasSl = keys.some((k) => ['sl_no', 'sl', 'serial_no', 'serial_number', 's_no', 'no'].includes(k));
  if (!hasSl) {
    throw new Error(`CSV is missing a serial-number column. Found headers: ${Object.keys(first).join(', ')}`);
  }

  const hasIdea = keys.some((k) => ['idea', 'project', 'project_idea', 'name', 'title'].includes(k));
  if (!hasIdea) {
    throw new Error(`CSV is missing an idea/project column. Found headers: ${Object.keys(first).join(', ')}`);
  }

  const items: IdeaItem[] = [];

  for (const row of records) {
    const rawSl = getField(row, 'sl_no', 'sl', 'serial_no', 'serial_number', 's_no', 'no');
    const slNo = parseInt(rawSl, 10);
    if (isNaN(slNo)) continue;

    const idea = getField(row, 'idea', 'project', 'project_idea', 'name', 'title');
    if (!idea) continue;

    const automatable = getField(row, 'agent_automatable', 'automatable', 'automation') || 'YES';
    const upper = automatable.toUpperCase();
    if (['NO', 'FALSE', 'N', 'NOT AUTOMATABLE'].includes(upper)) {
      continue;
    }

    const slug = generateSlug(idea);

    items.push({
      sl_no: slNo,
      idea,
      slug,
      automatable,
      sourceRow: row,
    });
  }

  return items.sort((a, b) => a.sl_no - b.sl_no);
}

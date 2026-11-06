import fs from 'node:fs';
import path from 'node:path';
import { parseIdeasCsv, IdeaItem } from './parser.js';

export function convertGoogleSheetsUrl(url: string): string {
  if (/docs\.google\.com\/spreadsheets\/d\//.test(url) && /\/edit(?:\?|$)/.test(url)) {
    try {
      const u = new URL(url);
      const gid = u.searchParams.get('gid') || '0';
      const base = url.split('/edit')[0];
      return `${base}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    } catch {
      return url;
    }
  }
  return url;
}

export async function fetchIdeaSource(
  sourceType: 'csv-url' | 'local-csv' | 'google-sheets',
  source: string,
  baseDir?: string
): Promise<string> {
  if (sourceType === 'google-sheets') {
    const exportUrl = convertGoogleSheetsUrl(source);
    const resp = await fetch(exportUrl);
    if (!resp.ok) {
      throw new Error(`Failed to fetch Google Sheets CSV (${resp.status} ${resp.statusText})`);
    }
    return resp.text();
  }

  if (sourceType === 'csv-url' || source.startsWith('http://') || source.startsWith('https://')) {
    const exportUrl = convertGoogleSheetsUrl(source);
    const resp = await fetch(exportUrl);
    if (!resp.ok) {
      throw new Error(`Failed to fetch CSV from ${source} (${resp.status} ${resp.statusText})`);
    }
    return resp.text();
  }

  // Local file
  const localPath = baseDir ? path.resolve(baseDir, source) : path.resolve(source);
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local CSV file not found: ${localPath}`);
  }
  return fs.readFileSync(localPath, 'utf8');
}

export async function loadIdeas(
  sourceType: 'csv-url' | 'local-csv' | 'google-sheets',
  source: string,
  baseDir?: string
): Promise<IdeaItem[]> {
  const content = await fetchIdeaSource(sourceType, source, baseDir);
  return parseIdeasCsv(content);
}

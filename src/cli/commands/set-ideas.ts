import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { loadConfig, saveConfig, resolveProjectsRoot } from '../../config/loader.js';
import { convertGoogleSheetsUrl } from '../../csv/sources.js';

export function runSetIdeas(source: string, projectsDir?: string): void {
  const root = resolveProjectsRoot(projectsDir);
  const config = loadConfig(root);

  let sourceType = config.ideaSourceType;
  let finalSource = source;

  if (source.startsWith('http://') || source.startsWith('https://')) {
    if (source.includes('docs.google.com/spreadsheets')) {
      sourceType = 'google-sheets';
      finalSource = convertGoogleSheetsUrl(source);
    } else {
      sourceType = 'csv-url';
    }
  } else {
    sourceType = 'local-csv';
    finalSource = path.resolve(source);
    if (!fs.existsSync(finalSource)) {
      console.error(pc.red(`CSV file not found: ${finalSource}`));
      process.exitCode = 1;
      return;
    }
  }

  saveConfig(root, {
    ideaSourceType: sourceType,
    ideaSource: finalSource,
  });

  console.log(pc.green(`✓ Idea source updated to ${sourceType}: ${finalSource}`));
}

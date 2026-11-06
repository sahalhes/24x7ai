import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  constructor(private logFilePath?: string, private prefix = '') {}

  info(message: string, ...meta: any[]): void {
    this.log('info', message, meta);
  }

  warn(message: string, ...meta: any[]): void {
    this.log('warn', message, meta);
  }

  error(message: string, ...meta: any[]): void {
    this.log('error', message, meta);
  }

  debug(message: string, ...meta: any[]): void {
    this.log('debug', message, meta);
  }

  private log(level: LogLevel, message: string, meta: any[]): void {
    const timestamp = new Date().toISOString();
    const formattedPrefix = this.prefix ? `[${this.prefix}] ` : '';
    const plain = `${timestamp} ${level.toUpperCase().padEnd(5)} ${formattedPrefix}${message}`;

    // Colorized console output
    let coloredLevel = level.toUpperCase();
    if (level === 'info') coloredLevel = pc.cyan(coloredLevel);
    else if (level === 'warn') coloredLevel = pc.yellow(coloredLevel);
    else if (level === 'error') coloredLevel = pc.red(coloredLevel);
    else coloredLevel = pc.gray(coloredLevel);

    const consoleOutput = `${pc.gray(timestamp)} ${coloredLevel.padEnd(5)} ${formattedPrefix}${message}`;

    if (level === 'error') {
      console.error(consoleOutput, ...meta);
    } else {
      console.log(consoleOutput, ...meta);
    }

    if (this.logFilePath) {
      try {
        fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
        const metaStr = meta.length > 0 ? ` ${JSON.stringify(meta)}` : '';
        fs.appendFileSync(this.logFilePath, `${plain}${metaStr}\n`, 'utf8');
      } catch {
        // ignore file write errors
      }
    }
  }
}

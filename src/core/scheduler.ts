export function parseIntervalMs(schedule: string): number {
  const trimmed = schedule.trim();

  // Pattern: */N * * * * (every N minutes)
  const minuteMatch = trimmed.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (minuteMatch) {
    const mins = parseInt(minuteMatch[1], 10);
    return mins * 60 * 1000;
  }

  // Pattern: 0 * * * * (hourly)
  if (trimmed === '0 * * * *') {
    return 60 * 60 * 1000;
  }

  // Pattern: 0 0 * * * (daily)
  if (trimmed === '0 0 * * *') {
    return 24 * 60 * 60 * 1000;
  }

  // Default fallback: 30 minutes
  return 30 * 60 * 1000;
}

export function computeNextRun(schedule: string, baseDate = new Date()): Date {
  const intervalMs = parseIntervalMs(schedule);
  return new Date(baseDate.getTime() + intervalMs);
}

export function isRunDue(nextRunAt?: string, backoffUntil?: string): boolean {
  const now = Date.now();

  if (backoffUntil) {
    const backoffTime = new Date(backoffUntil).getTime();
    if (now < backoffTime) return false;
  }

  if (!nextRunAt) return true;

  const dueTime = new Date(nextRunAt).getTime();
  return now >= dueTime;
}

export function computeBackoffUntil(consecutiveErrors: number, baseMs = 60 * 1000): string {
  // Exponential backoff: 1m, 2m, 4m, 8m, capped at 1 hour
  const factor = Math.min(Math.pow(2, consecutiveErrors - 1), 60);
  const backoffMs = factor * baseMs;
  return new Date(Date.now() + backoffMs).toISOString();
}

export function isValidCron(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/);
  return parts.length === 5;
}

export function describeSchedule(schedule: string): string {
  const trimmed = schedule.trim();
  if (trimmed === '0 * * * *') return 'Hourly at minute 0';
  if (trimmed === '0 0 * * *') return 'Daily at midnight';
  const minMatch = trimmed.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (minMatch) return `Every ${minMatch[1]} minutes`;
  return `Custom schedule: ${schedule}`;
}

export interface FleetEvent {
  event: 'mvp_complete' | 'daemon_stuck' | 'daemon_error';
  projectSlug: string;
  slNo?: number;
  message: string;
  timestamp: string;
}

export async function sendWebhook(url?: string, event?: FleetEvent): Promise<boolean> {
  if (!url || !event) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    return res.ok;
  } catch {
    return false;
  }
}

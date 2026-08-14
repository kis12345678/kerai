import type { MissionStatus, Tone } from './types';

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDateTime(iso);
}

/** Display labels + tones for backend mission statuses. */
export const MISSION_STATUS: Record<MissionStatus, { label: string; tone: Tone }> = {
  Created: { label: 'Created', tone: 'neutral' },
  Running: { label: 'Running', tone: 'accent' },
  WaitingForApproval: { label: 'Waiting for approval', tone: 'warning' },
  Verifying: { label: 'Verifying', tone: 'accent' },
  Completed: { label: 'Completed', tone: 'success' },
  Failed: { label: 'Failed', tone: 'error' },
  Cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const TERMINAL_STATUSES: MissionStatus[] = ['Completed', 'Failed', 'Cancelled'];

/** Human-readable byte sizes. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

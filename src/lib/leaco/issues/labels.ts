import type { IssueKind } from './conditions';

/** Words for issues, shared by the Issues page, the Overview and the activity log. */
export const KIND_LABEL: Record<IssueKind, string> = {
	SHUTDOWN: 'Shut down',
	IDLE: 'Idle',
	OFFLINE: 'Offline',
	TICKET: 'Open ticket',
	STUCK: 'Not taking water',
	WATER_DROP: 'Water drop',
	REPORT_LATE: 'Report late'
};

/** Symbol shape for each kind (DESIGN.md → Status). */
export const KIND_GLYPH: Record<IssueKind, { mark: string; tone: 'danger' | 'warn' | 'offline'; shape: 'circle' | 'square' }> = {
	SHUTDOWN: { mark: '✕', tone: 'danger', shape: 'circle' },
	IDLE: { mark: '◐', tone: 'warn', shape: 'circle' },
	OFFLINE: { mark: '?', tone: 'offline', shape: 'circle' },
	TICKET: { mark: '!', tone: 'warn', shape: 'square' },
	STUCK: { mark: '✕', tone: 'danger', shape: 'square' },
	WATER_DROP: { mark: '▼', tone: 'danger', shape: 'square' },
	REPORT_LATE: { mark: '!', tone: 'warn', shape: 'square' }
};

export const STATUS_LABEL = {
	OPEN: 'Open',
	CONTRACTOR_SENT: 'Contractor sent',
	ARCHIVED: 'Archived',
	RESOLVED: 'Resolved'
} as const;

export const REASONS = [
	{ value: 'NORMAL_FOR_WELL', label: 'Normal for this well', hint: 'For example, idle on a timer' },
	{ value: 'NOT_URGENT', label: 'Not urgent: check on the next visit', hint: null },
	{ value: 'SCHEDULED', label: 'Already scheduled', hint: null },
	{ value: 'DATA_PROBLEM', label: 'Data problem, not a field problem', hint: 'For example, a sensor that’s offline' }
] as const;

export const REASON_LABEL: Record<(typeof REASONS)[number]['value'], string> = Object.fromEntries(REASONS.map((r) => [r.value, r.label])) as never;

/** "3 hours", "2 days": how long since a time. */
export function sinceText(iso: string, now = Date.now()): string {
	const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
	if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min`;
	const hours = Math.round(mins / 60);
	if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
	const days = Math.round(hours / 24);
	return `${days} days`;
}

export function dayText(isoDate: string): string {
	return new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

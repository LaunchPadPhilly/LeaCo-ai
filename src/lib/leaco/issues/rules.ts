/**
 * When the dashboard opens an issue (Issues → Rules, DESIGN.md). Each rule has a default; a
 * row in LeacoIssueRule overrides it. Only admins change rules. Pure: no server imports.
 */
export const RULE_KEYS = ['well_shutdown', 'well_idle', 'device_offline', 'ticket', 'injector_stuck', 'water_drop', 'report_late'] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export type TicketPriority = 'p1_p2' | 'p1' | 'any';

export type Rule = { key: RuleKey; enabled: boolean; threshold: number | null; option: string | null };
export type Rules = Record<RuleKey, Rule>;

export type RuleDef = {
	key: RuleKey;
	group: 'wells' | 'injectors';
	title: string;
	/** "Open an issue after {n} hours shut down", with {n} replaced by the threshold field. */
	sentence: string;
	unit: 'hours' | 'reports' | 'percent' | 'hour-of-day' | null;
	min: number;
	max: number;
	help: string;
	default: Omit<Rule, 'key'>;
};

export const RULE_DEFS: Record<RuleKey, RuleDef> = {
	well_shutdown: {
		key: 'well_shutdown',
		group: 'wells',
		title: 'A well shuts down',
		sentence: 'Open an issue after it has been shut down for {n} hours',
		unit: 'hours',
		min: 0,
		max: 168,
		help: '0 means as soon as it is seen.',
		default: { enabled: true, threshold: 0, option: null }
	},
	well_idle: {
		key: 'well_idle',
		group: 'wells',
		title: 'A well stays idle',
		sentence: 'Open an issue after it has been idle for {n} hours',
		unit: 'hours',
		min: 1,
		max: 336,
		help: 'Many wells idle on timers. Counted from when the dashboard first saw it idle; a run in between starts the count again.',
		default: { enabled: true, threshold: 24, option: null }
	},
	device_offline: {
		key: 'device_offline',
		group: 'wells',
		title: 'A device stops checking in',
		sentence: 'Open an issue after no check-in for {n} hours',
		unit: 'hours',
		min: 1,
		max: 336,
		help: 'The well may be fine; its status is just out of date.',
		default: { enabled: true, threshold: 24, option: null }
	},
	ticket: {
		key: 'ticket',
		group: 'wells',
		title: 'An Amplified ticket opens',
		sentence: 'Open an issue for tickets of priority {option}',
		unit: null,
		min: 0,
		max: 0,
		help: 'Tickets with no priority count under “Any priority”.',
		default: { enabled: true, threshold: null, option: 'any' }
	},
	injector_stuck: {
		key: 'injector_stuck',
		group: 'injectors',
		title: 'An injector stops taking water',
		sentence: 'Open an issue when the daily report shows it not taking water',
		unit: null,
		min: 0,
		max: 0,
		help: 'Injectors the report lists as idle don’t count.',
		default: { enabled: true, threshold: null, option: null }
	},
	water_drop: {
		key: 'water_drop',
		group: 'injectors',
		title: 'Total water injected drops',
		sentence: 'Open an issue when a day is more than {n}% below the 7-day average',
		unit: 'percent',
		min: 1,
		max: 90,
		help: 'Compares the latest report with the average of the 7 reports before it.',
		default: { enabled: true, threshold: 20, option: null }
	},
	report_late: {
		key: 'report_late',
		group: 'injectors',
		title: 'The daily report is late',
		sentence: 'Open an issue if no report for the day before has arrived by {n}:00 (Central)',
		unit: 'hour-of-day',
		min: 0,
		max: 23,
		help: 'Off by default.',
		default: { enabled: false, threshold: 9, option: null }
	}
};

export const TICKET_PRIORITIES: { value: TicketPriority; label: string }[] = [
	{ value: 'p1_p2', label: 'P1 and P2' },
	{ value: 'p1', label: 'P1 only' },
	{ value: 'any', label: 'Any priority' }
];

export function defaultRules(): Rules {
	return Object.fromEntries(RULE_KEYS.map((k) => [k, { key: k, ...RULE_DEFS[k].default }])) as Rules;
}

/** Saved rows over the defaults. Unknown keys are ignored; out-of-range numbers are clamped. */
export function mergeRules(rows: { key: string; enabled: boolean; threshold: number | null; option: string | null }[]): Rules {
	const rules = defaultRules();
	for (const row of rows) {
		if (!(RULE_KEYS as readonly string[]).includes(row.key)) continue;
		const def = RULE_DEFS[row.key as RuleKey];
		rules[row.key as RuleKey] = {
			key: def.key,
			enabled: row.enabled,
			threshold: def.unit ? clamp(row.threshold ?? def.default.threshold ?? def.min, def.min, def.max) : null,
			option: def.key === 'ticket' ? parsePriority(row.option) : null
		};
	}
	return rules;
}

export function parsePriority(v: string | null | undefined): TicketPriority {
	return v === 'p1_p2' || v === 'p1' || v === 'any' ? v : 'any';
}

/** Does a ticket's priority text count under the rule? Unknown priorities count only under "any". */
export function priorityCounts(priority: string | null, rule: TicketPriority): boolean {
	if (rule === 'any') return true;
	const n = priority ? Number(/(\d)/.exec(priority)?.[1]) : NaN;
	if (!Number.isFinite(n)) return false;
	return rule === 'p1' ? n === 1 : n <= 2;
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.round(n)));
}

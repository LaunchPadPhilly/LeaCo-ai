import { z } from 'zod';

/**
 * One parsed "LeaCo Daily Report", in the shape `reference/reference_scripts/parse_daily.py`
 * writes to `daily_parsed.json`. Only the fields the app reads are declared; the rest pass
 * through untouched. `null` always means the report did not give the value. It is never 0.
 *
 * This is the interim input. Once the Amplified API is wired up (docs/leaco/PLAN.md §2a),
 * API data is normalized to this same shape so the rules in `rules.ts` keep working.
 */
const volume = z.number().nullable();
const countPair = z.tuple([z.number().int(), z.number().int()]).nullable();

export const leaseRowSchema = z.looseObject({
	water: volume,
	oil: volume
});

export const injectorRowSchema = z.looseObject({
	name: z.string(),
	vol: volume
});

export const dailyReportSchema = z.looseObject({
	date: z.iso.date(),
	water: volume,
	oil: volume,
	own_water: volume.optional(),
	third_party: volume.optional(),
	/** Report header: injectors taking water / total. Authoritative for the KPI (PLAN D4). */
	inj_taking: countPair,
	/** Report header: wells running / total. */
	wells_running: countPair,
	leases: z.record(z.string(), leaseRowSchema),
	injectors: z.record(z.string(), injectorRowSchema).default({}),
	other_injectors: z.object({ count: z.number().int(), vol: volume }).nullable().optional()
});

export const dailyReportsFileSchema = z.record(z.iso.date(), dailyReportSchema);

export type DailyReport = z.infer<typeof dailyReportSchema>;

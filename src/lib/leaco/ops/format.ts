/** Number formatting for the dashboard. Null renders "No data", never "0" or "—". */
export function fmt(value: number | null | undefined, decimals = 0): string {
	if (value === null || value === undefined || Number.isNaN(value)) return 'No data';
	return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Signed change in words, e.g. "Up 9,029" / "Down 3" / "No change". */
export function changeWords(delta: number | null, decimals = 0): string | null {
	if (delta === null) return null;
	if (delta === 0) return 'No change';
	return `${delta > 0 ? 'Up' : 'Down'} ${fmt(Math.abs(delta), decimals)}`;
}

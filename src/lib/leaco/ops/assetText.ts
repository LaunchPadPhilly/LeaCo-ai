import { fmt } from './format';
import type { AssetDay } from './types';

/** An injector's volume for one day, in words that say where the number came from. */
export function volumeText(day: AssetDay | undefined): string {
	if (!day) return 'Not in report';
	switch (day.volumeSource) {
		case 'reading':
			return `${fmt(day.volume, day.volume !== null && day.volume < 10 ? 1 : 0)} bbl`;
		case 'no-reading':
			return 'No reading';
		case 'grouped':
			return day.groupedSmall ? 'Small amount (grouped)' : '≈0 (grouped)';
		default:
			return 'Not in report';
	}
}

export function pressureText(day: AssetDay | undefined): string {
	if (!day || day.volumeSource === 'grouped' || day.volumeSource === 'absent') return 'Not reported';
	return day.pressure === null ? 'No reading' : `${fmt(day.pressure)} psi`;
}

export const GROUPED_EXPLAINER =
	'“Grouped” means the report didn’t list this injector that day; it was counted under “all other injectors”, which took little or nothing.';

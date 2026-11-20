/** Details for a clicked map feature that isn't a well or injector (road, route, gap…). */
export type FeatureInfo = {
	title: string;
	/** What it is and where the data comes from, e.g. "Public road · U.S. Census TIGER". */
	source: string;
	rows: [string, string][];
	note?: { head: string; text: string };
	/** An open question for LeaCo (docs/leaco/open-questions.md). */
	question?: string;
};

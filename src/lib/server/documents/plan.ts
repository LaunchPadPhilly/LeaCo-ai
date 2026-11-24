import type { DropboxFile, DropboxRoot } from '../dropbox/client.ts';

/**
 * Pure planning helpers for the document sync: no database, no network, so unit tests can
 * import them without a DATABASE_URL.
 */

/** Non-PDF text is split into sections of about this size so search snippets stay focused. */
const SECTION_CHARS = 20_000;

export type ExistingDocument = {
	id: string;
	sourceFileId: string;
	path: string;
	contentHash: string | null;
	status: 'ACTIVE' | 'REMOVED';
};

export type FilePlan = { file: DropboxFile; path: string; existing?: ExistingDocument };

export type ChangePlan = {
	added: FilePlan[];
	updated: FilePlan[];
	moved: FilePlan[];
	unchanged: FilePlan[];
	removed: ExistingDocument[];
};

/** Path relative to the root folder, in Dropbox's display case. */
export function relativePath(root: Pick<DropboxRoot, 'pathLower'>, file: Pick<DropboxFile, 'pathLower' | 'pathDisplay'>): string {
	const prefix = root.pathLower.endsWith('/') ? root.pathLower : `${root.pathLower}/`;
	if (root.pathLower && file.pathLower.startsWith(prefix)) return file.pathDisplay.slice(prefix.length);
	return file.pathDisplay.replace(/^\//, '');
}

export function folderOf(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? '' : path.slice(0, index);
}

/** Pure diff between a Dropbox listing and the stored top-level documents. */
export function planChanges(root: Pick<DropboxRoot, 'pathLower'>, files: DropboxFile[], existing: ExistingDocument[], force = false): ChangePlan {
	const byId = new Map(existing.map((doc) => [doc.sourceFileId, doc]));
	const plan: ChangePlan = { added: [], updated: [], moved: [], unchanged: [], removed: [] };
	const seen = new Set<string>();

	for (const file of files) {
		seen.add(file.id);
		const path = relativePath(root, file);
		const doc = byId.get(file.id);
		const item = { file, path, existing: doc };
		if (!doc || doc.status === 'REMOVED') plan.added.push(item);
		else if (force || doc.contentHash !== file.contentHash) plan.updated.push(item);
		else if (doc.path !== path) plan.moved.push(item);
		else plan.unchanged.push(item);
	}
	for (const doc of existing) if (doc.status === 'ACTIVE' && !seen.has(doc.sourceFileId)) plan.removed.push(doc);
	return plan;
}

/** Splits long single-page text into sections at paragraph boundaries. */
export function toSections(text: string, size = SECTION_CHARS): string[] {
	if (text.length <= size) return [text];
	const sections: string[] = [];
	let current = '';
	for (const paragraph of text.split('\n\n')) {
		if (current && current.length + paragraph.length + 2 > size) {
			sections.push(current);
			current = '';
		}
		if (paragraph.length > size) {
			for (let i = 0; i < paragraph.length; i += size) sections.push(paragraph.slice(i, i + size));
			continue;
		}
		current = current ? `${current}\n\n${paragraph}` : paragraph;
	}
	if (current) sections.push(current);
	return sections;
}

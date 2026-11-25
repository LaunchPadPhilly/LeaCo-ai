import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '$lib/server/prisma';
import { Prisma } from '../../../../prisma/generated/prisma/client.ts';
import { downloadToFile, getRoot, listAllFiles, type DropboxFile } from '$lib/server/dropbox/client';
import { extract, kindOf, type DocumentKindName, type Extracted } from './extract.ts';
import { folderOf, planChanges, toSections, type ExistingDocument, type FilePlan } from './plan.ts';

export { folderOf, planChanges, relativePath, toSections, type ChangePlan, type ExistingDocument, type FilePlan } from './plan.ts';

/**
 * Incremental sync from the Dropbox root folder into the Document tables.
 *
 * - New files and files whose content hash changed are downloaded and read.
 * - Renamed or moved files (same Dropbox id, same content) only get their path updated.
 * - Files gone from Dropbox are marked REMOVED, never deleted, so history and citations
 *   keep resolving.
 * - A run that fails on one file records that file as FAILED and carries on.
 * - Only one run at a time (a partial unique index on the RUNNING row).
 *
 * Logging goes through the `log` callback the caller passes. Without --verbose it receives
 * counts only; with --verbose it also receives relative paths (never file contents).
 */

const SOURCE = 'dropbox';
/** Postgres tsvector input is limited to 1 MB; stay well under it per page. */
const MAX_PAGE_CHARS = 400_000;
const EXTRACT_TIMEOUT_MS = 5 * 60_000;
/** A RUNNING row older than this is a crashed run; it is closed as FAILED so a new run can start. */
const STALE_RUN_MS = 3 * 60 * 60_000;

// --- Running -----------------------------------------------------------------------

export type IngestOptions = { dryRun?: boolean; force?: boolean; verbose?: boolean; log?: (line: string) => void };

export type IngestCounts = {
	listed: number;
	added: number;
	updated: number;
	moved: number;
	removed: number;
	unchanged: number;
	failed: number;
	noText: number;
	attachments: number;
	largestFileBytes: number;
};

export type IngestResult =
	| { status: 'ok'; dryRun: boolean; counts: IngestCounts; rootPath: string; changes?: { added: string[]; updated: string[]; moved: string[]; removed: string[] } }
	| { status: 'already_running'; runningSince: string }
	| { status: 'failed'; reason: string };

class AlreadyRunning extends Error {
	constructor(readonly since: Date) {
		super('ALREADY_RUNNING');
	}
}

async function loadExisting(): Promise<ExistingDocument[]> {
	return prisma.document.findMany({
		where: { source: SOURCE, parentId: null },
		select: { id: true, sourceFileId: true, path: true, contentHash: true, status: true }
	});
}

/** Lists Dropbox and compares; writes nothing. Shared by --dry-run and the MCP tool. */
export async function previewChanges(force = false) {
	const [root, files, existing] = await Promise.all([getRoot(), listAllFiles(), loadExisting()]);
	return { root, files, plan: planChanges(root, files, existing, force) };
}

export async function runIngest(options: IngestOptions = {}): Promise<IngestResult> {
	const log = options.log ?? (() => {});
	const counts: IngestCounts = { listed: 0, added: 0, updated: 0, moved: 0, removed: 0, unchanged: 0, failed: 0, noText: 0, attachments: 0, largestFileBytes: 0 };

	if (options.dryRun) {
		const { root, files, plan } = await previewChanges(options.force);
		Object.assign(counts, {
			listed: files.length,
			added: plan.added.length,
			updated: plan.updated.length,
			moved: plan.moved.length,
			removed: plan.removed.length,
			unchanged: plan.unchanged.length,
			largestFileBytes: Math.max(0, ...files.map((f) => f.size))
		});
		return {
			status: 'ok',
			dryRun: true,
			counts,
			rootPath: root.pathDisplay,
			changes: options.verbose
				? {
						added: plan.added.map((p) => p.path),
						updated: plan.updated.map((p) => p.path),
						moved: plan.moved.map((p) => `${p.existing?.path} → ${p.path}`),
						removed: plan.removed.map((d) => d.path)
					}
				: undefined
		};
	}

	let runId: string;
	try {
		runId = await startRun(Boolean(options.force));
	} catch (error) {
		if (error instanceof AlreadyRunning) return { status: 'already_running', runningSince: error.since.toISOString() };
		throw error;
	}

	try {
		const { root, files, plan } = await previewChanges(options.force);
		counts.listed = files.length;
		counts.unchanged = plan.unchanged.length;
		counts.largestFileBytes = Math.max(0, ...files.map((f) => f.size));
		log(`root=${root.pathDisplay} listed=${files.length} added=${plan.added.length} updated=${plan.updated.length} moved=${plan.moved.length} removed=${plan.removed.length}`);

		const workDir = await mkdtemp(join(tmpdir(), 'documents-ingest-'));
		try {
			for (const [label, items] of [['added', plan.added], ['updated', plan.updated]] as const) {
				for (const item of items) {
					const outcome = await ingestFile(item, workDir);
					counts[label]++;
					counts.attachments += outcome.attachments;
					if (outcome.extraction === 'FAILED') counts.failed++;
					if (outcome.extraction === 'NO_TEXT') counts.noText++;
					if (options.verbose) log(`${label} ${outcome.extraction} ${formatBytes(item.file.size)} ${item.path}`);
				}
			}
		} finally {
			await rm(workDir, { recursive: true, force: true });
		}

		for (const item of plan.moved) {
			await prisma.document.update({
				where: { id: item.existing!.id },
				data: { path: item.path, folder: folderOf(item.path), name: item.file.name, modifiedAt: parseDate(item.file.serverModified) }
			});
			counts.moved++;
			if (options.verbose) log(`moved ${item.existing!.path} → ${item.path}`);
		}

		const removedAt = new Date();
		for (const doc of plan.removed) {
			await prisma.document.updateMany({ where: { OR: [{ id: doc.id }, { parentId: doc.id }] }, data: { status: 'REMOVED', removedAt } });
			counts.removed++;
			if (options.verbose) log(`removed ${doc.path}`);
		}

		await prisma.documentIngestRun.update({ where: { id: runId }, data: { status: 'SUCCEEDED', finishedAt: new Date(), counts } });
		return { status: 'ok', dryRun: false, counts, rootPath: root.pathDisplay };
	} catch (error) {
		const reason = error instanceof Error ? error.message.slice(0, 300) : 'Ingest failed.';
		await prisma.documentIngestRun.update({ where: { id: runId }, data: { status: 'FAILED', finishedAt: new Date(), counts, error: reason } });
		return { status: 'failed', reason };
	}
}

async function startRun(force: boolean): Promise<string> {
	await prisma.documentIngestRun.updateMany({
		where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
		data: { status: 'FAILED', finishedAt: new Date(), error: 'Closed as stale: the run did not finish.' }
	});
	try {
		const run = await prisma.documentIngestRun.create({ data: { force } });
		return run.id;
	} catch (error) {
		if ((error as { code?: string }).code === 'P2002') {
			const running = await prisma.documentIngestRun.findFirst({ where: { status: 'RUNNING' }, select: { startedAt: true } });
			throw new AlreadyRunning(running?.startedAt ?? new Date());
		}
		throw error;
	}
}

function parseDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatBytes(bytes: number) {
	if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}MB`;
	return `${Math.round(bytes / 1024)}KB`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`Reading the file took longer than ${Math.round(ms / 60_000)} minutes.`)), ms);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

function safeReason(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/\s+/g, ' ').slice(0, 200) || 'Unknown error.';
}

/** Page texts ready to store: sections for single-page kinds, capped per page. */
function pagesFor(kind: DocumentKindName, extracted: Extracted): string[] {
	const pages = kind === 'PDF' ? extracted.pages : extracted.pages.flatMap((page) => toSections(page));
	return pages.map((page) => (page.length > MAX_PAGE_CHARS ? page.slice(0, MAX_PAGE_CHARS) : page));
}

async function ingestFile(item: FilePlan, workDir: string): Promise<{ extraction: 'OK' | 'NO_TEXT' | 'UNSUPPORTED' | 'FAILED'; attachments: number }> {
	const { file, path } = item;
	const kind = kindOf(file.name);
	const base = {
		source: SOURCE,
		sourceFileId: file.id,
		path,
		folder: folderOf(path),
		name: file.name,
		kind,
		sizeBytes: file.size,
		contentHash: file.contentHash,
		modifiedAt: parseDate(file.serverModified),
		status: 'ACTIVE' as const,
		removedAt: null
	};

	let extracted: Extracted | null = null;
	let failure: string | null = null;
	if (kind === 'OTHER') {
		extracted = { status: 'UNSUPPORTED', pages: [], note: 'File type is not read.' };
	} else {
		const tmp = join(workDir, 'file');
		try {
			await downloadToFile(file.id, tmp);
			const bytes = new Uint8Array(await readFile(tmp));
			extracted = await withTimeout(extract(kind, file.name, bytes), EXTRACT_TIMEOUT_MS);
		} catch (error) {
			failure = safeReason(error);
		} finally {
			await rm(tmp, { force: true });
		}
	}

	const pages = extracted ? pagesFor(kind, extracted) : [];
	const extraction: 'OK' | 'NO_TEXT' | 'UNSUPPORTED' | 'FAILED' = failure ? 'FAILED' : extracted!.status;
	const data = {
		...base,
		extraction,
		extractionNote: failure ?? extracted?.note ?? null,
		pageCount: pages.length,
		meta: (extracted?.meta as Prisma.InputJsonValue | undefined) ?? undefined
	};

	const document = await prisma.$transaction(async (tx) => {
		const doc = await tx.document.upsert({
			where: { source_sourceFileId: { source: SOURCE, sourceFileId: file.id } },
			create: data,
			update: { ...data, meta: (extracted?.meta as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull }
		});
		await tx.documentPage.deleteMany({ where: { documentId: doc.id } });
		await tx.documentPlace.deleteMany({ where: { documentId: doc.id } });
		await tx.document.deleteMany({ where: { parentId: doc.id } });
		if (pages.length) {
			await tx.documentPage.createMany({ data: pages.map((text, i) => ({ documentId: doc.id, pageNumber: i + 1, text })) });
		}
		if (extracted?.places?.length) {
			await tx.documentPlace.createMany({
				data: extracted.places.map((p) => ({ documentId: doc.id, ...p, coordinates: p.coordinates ?? undefined }))
			});
		}
		return doc;
	}, { timeout: 120_000 });

	let attachmentCount = 0;
	for (const [index, attachment] of (extracted?.attachments ?? []).entries()) {
		await ingestAttachment(document.id, file, path, index, attachment);
		attachmentCount++;
	}
	return { extraction, attachments: attachmentCount };
}

async function ingestAttachment(parentId: string, file: DropboxFile, parentPath: string, index: number, attachment: { name: string; bytes: Uint8Array }) {
	const kind = kindOf(attachment.name);
	let extracted: Extracted | null = null;
	let failure: string | null = null;
	try {
		extracted = await withTimeout(extract(kind, attachment.name, attachment.bytes), EXTRACT_TIMEOUT_MS);
	} catch (error) {
		failure = safeReason(error);
	}
	const pages = extracted ? pagesFor(kind, extracted) : [];
	const path = `${parentPath} › ${attachment.name}`;
	await prisma.document.create({
		data: {
			source: SOURCE,
			sourceFileId: `${file.id}#${index}`,
			parentId,
			path,
			folder: folderOf(parentPath),
			name: attachment.name,
			kind,
			sizeBytes: attachment.bytes.byteLength,
			contentHash: file.contentHash,
			modifiedAt: parseDate(file.serverModified),
			extraction: failure ? 'FAILED' : extracted!.status,
			extractionNote: failure ?? extracted?.note ?? null,
			pageCount: pages.length,
			meta: (extracted?.meta as Prisma.InputJsonValue | undefined) ?? undefined,
			pages: pages.length ? { create: pages.map((text, i) => ({ pageNumber: i + 1, text })) } : undefined,
			places: extracted?.places?.length
				? { create: extracted.places.map((p) => ({ ...p, coordinates: p.coordinates ?? undefined })) }
				: undefined
		}
	});
}

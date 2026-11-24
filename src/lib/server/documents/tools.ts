import { z } from 'zod';
import { prisma } from '$lib/server/prisma';
import type { McpToolDefinition } from '$lib/server/mcp/handler';
import { DropboxError, isDropboxConfigured } from '$lib/server/dropbox/client';
import { previewChanges } from './ingest.ts';

/**
 * MCP tools over the ingested documents (ADR 0003). All read the database only, except
 * document_source_changes, which also lists Dropbox (read-only scopes). Gated by
 * DOCUMENTS_READ: the folder holds contracts and correspondence with other companies, so it
 * is granted per user rather than riding on data:read.
 */

const SCOPE = 'DOCUMENTS_READ' as const;
const KINDS = ['PDF', 'DOCX', 'MSG', 'KMZ', 'OTHER'] as const;
const DEFAULT_MAX_CHARS = 30_000;

/** Keeps the handler's input typed from its own shape, then widens for the shared list. */
function defineTool<Shape extends z.ZodRawShape>(tool: McpToolDefinition<Shape>): McpToolDefinition {
	return tool as unknown as McpToolDefinition;
}

/** Instructions sent to MCP clients at connect time. */
export const documentsInstructions = [
	'Documents come from LeaCo\'s Dropbox folder, synced into this server. Citing is required whenever you state anything taken from a document:',
	'- Put the source directly under the claim, as: — *<file name>*, <folder>, page <N>',
	'  > "<exact quote>"',
	'- Quotes are copied verbatim from tool results (document_get text or a search snippet without its « » markers). Never paraphrase inside quotation marks or join separate passages; mark omissions with "…". Keep each quote to a sentence or two.',
	'- For emails (kind MSG) cite the subject, sender and sent date as well. For email attachments, cite the attachment name and the email it came from.',
	'- Page numbers are real PDF pages. For Word documents and emails, "page" is a section of the text; say "section N" instead.',
	'- Map pins (document_places) are cited by file name and pin name, with the coordinates.',
	'- Documents marked NO_TEXT (scanned PDFs) or FAILED could not be read; say so rather than guessing at their contents.',
	'- If the documents do not contain the answer, say so plainly.'
].join('\n');

function notConfigured() {
	return { error: { code: 'NOT_CONFIGURED', message: 'The Dropbox document source is not configured in this environment.' } };
}

function folderFilter(folder: string | undefined) {
	if (folder === undefined) return {};
	const clean = folder.replace(/^\/+|\/+$/g, '');
	return clean === '' ? {} : { OR: [{ folder: clean }, { folder: { startsWith: `${clean}/` } }] };
}

type SearchRow = {
	id: string;
	path: string;
	folder: string;
	name: string;
	kind: string;
	modifiedAt: Date | null;
	parentId: string | null;
	pageNumber: number;
	rank: number;
	snippet: string;
};

const searchTool = defineTool({
	name: 'documents_search',
	description:
		"Keyword search across the text of LeaCo's Dropbox documents (PDF pages, Word documents, Outlook emails and their attachments, KMZ map pins). " +
		'Supports quoted phrases, OR, and -exclusions (web-search syntax). Returns the best-matching pages with a snippet (matches marked « »), plus files whose name matches. ' +
		"Example: 'what does the Oncor agreement say about easement width?' → { query: 'easement width', folder: 'Oncor' }. " +
		'Follow up with document_get for the full page text before quoting.',
	inputSchema: {
		query: z.string().trim().min(2).max(200).describe('Words or phrases to find.'),
		folder: z.string().max(300).optional().describe('Limit to a folder and its subfolders, e.g. "Daily Reports" or "Oncor".'),
		kind: z.enum(KINDS).optional().describe('Limit to one file type.'),
		limit: z.number().int().min(1).max(25).optional().describe('Maximum page hits (default 10).')
	},
	requiredScope: SCOPE,
	handler: async ({ query, folder, kind, limit = 10 }) => {
		const cleanFolder = folder?.replace(/^\/+|\/+$/g, '') || null;
		const folderPrefix = cleanFolder ? `${cleanFolder}/%` : null;
		const kindValue = kind ?? null;
		const hits = await prisma.$queryRaw<SearchRow[]>`
			SELECT d.id, d.path, d.folder, d.name, d.kind::text AS kind, d."modifiedAt", d."parentId", p."pageNumber",
				ts_rank(p."searchVector", q)::float8 AS rank,
				ts_headline('english', p.text, q, 'MaxFragments=2, MaxWords=35, MinWords=12, StartSel=«, StopSel=», FragmentDelimiter= … ') AS snippet
			FROM "DocumentPage" p
			JOIN "Document" d ON d.id = p."documentId",
				websearch_to_tsquery('english', ${query}) q
			WHERE p."searchVector" @@ q
				AND d.status = 'ACTIVE'
				AND (${cleanFolder}::text IS NULL OR d.folder = ${cleanFolder} OR d.folder LIKE ${folderPrefix})
				AND (${kindValue}::text IS NULL OR d.kind::text = ${kindValue})
			ORDER BY rank DESC, d."modifiedAt" DESC NULLS LAST
			LIMIT ${limit}`;

		const nameMatches = await prisma.document.findMany({
			where: {
				status: 'ACTIVE',
				name: { contains: query, mode: 'insensitive' },
				...(kind ? { kind } : {}),
				...folderFilter(folder)
			},
			select: { id: true, path: true, kind: true, pageCount: true, extraction: true, modifiedAt: true },
			orderBy: { modifiedAt: 'desc' },
			take: 10
		});

		const total = await prisma.document.count({ where: { status: 'ACTIVE' } });
		return {
			query,
			hits: hits.map((h) => ({
				documentId: h.id,
				path: h.path,
				folder: h.folder,
				kind: h.kind,
				page: h.pageNumber,
				isAttachment: h.parentId !== null,
				modifiedAt: h.modifiedAt?.toISOString() ?? null,
				snippet: h.snippet
			})),
			nameMatches,
			note: total === 0 ? 'No documents have been ingested yet (run documents:ingest).' : undefined
		};
	}
});

const getTool = defineTool({
	name: 'document_get',
	description:
		'Full text of one document by id (from documents_search or document_folders_browse), with [Page N] markers, plus its email headers, attachments, and parent email if it is an attachment. ' +
		'Long documents are returned in parts: pass fromPage to continue where the previous call stopped (nextFromPage).',
	inputSchema: {
		documentId: z.string().min(1).max(64),
		fromPage: z.number().int().min(1).optional().describe('First page to return (default 1).'),
		toPage: z.number().int().min(1).optional().describe('Last page to return.'),
		maxChars: z.number().int().min(1000).max(100_000).optional().describe(`Character budget for page text (default ${DEFAULT_MAX_CHARS}).`)
	},
	requiredScope: SCOPE,
	handler: async ({ documentId, fromPage = 1, toPage, maxChars = DEFAULT_MAX_CHARS }) => {
		const doc = await prisma.document.findUnique({
			where: { id: documentId },
			select: {
				id: true, path: true, folder: true, name: true, kind: true, status: true, extraction: true, extractionNote: true,
				pageCount: true, sizeBytes: true, modifiedAt: true, meta: true,
				parent: { select: { id: true, path: true, meta: true } },
				attachments: { select: { id: true, name: true, kind: true, extraction: true, pageCount: true } },
				_count: { select: { places: true } }
			}
		});
		if (!doc) return { error: { code: 'NOT_FOUND', message: 'No document with that id.' } };

		const pages = await prisma.documentPage.findMany({
			where: { documentId, pageNumber: { gte: fromPage, ...(toPage ? { lte: toPage } : {}) } },
			orderBy: { pageNumber: 'asc' },
			select: { pageNumber: true, text: true }
		});
		const parts: string[] = [];
		let used = 0;
		let nextFromPage: number | null = null;
		for (const page of pages) {
			const block = `[Page ${page.pageNumber}]\n${page.text}`;
			if (used + block.length > maxChars && parts.length) {
				nextFromPage = page.pageNumber;
				break;
			}
			parts.push(block.length > maxChars ? `${block.slice(0, maxChars)}\n[… page truncated]` : block);
			used += block.length;
		}

		const { _count, ...rest } = doc;
		return {
			...rest,
			places: _count.places,
			text: parts.join('\n\n'),
			returnedPages: parts.length ? [pages[0].pageNumber, (nextFromPage ?? (pages.at(-1)?.pageNumber ?? fromPage) + 1) - 1] : [],
			nextFromPage
		};
	}
});

const browseTool = defineTool({
	name: 'document_folders_browse',
	description:
		"Browse LeaCo's Dropbox folder: the subfolders of a folder (with document counts) and the files directly in it (name, type, pages, readable or not, modified date). " +
		"Example: 'what is in the Daily Reports folder?' → { folder: 'Daily Reports' }. Omit folder for the top level.",
	inputSchema: {
		folder: z.string().max(300).optional().describe('Folder path relative to the root, e.g. "Oncor". Omit for the root.'),
		limit: z.number().int().min(1).max(500).optional().describe('Maximum files listed (default 200).')
	},
	requiredScope: SCOPE,
	handler: async ({ folder, limit = 200 }) => {
		const current = folder?.replace(/^\/+|\/+$/g, '') ?? '';
		const prefix = current ? `${current}/` : '';
		const grouped = await prisma.document.groupBy({
			by: ['folder'],
			where: { status: 'ACTIVE', parentId: null, ...(current ? { folder: { startsWith: prefix } } : {}) },
			_count: { _all: true }
		});
		const subfolders = new Map<string, number>();
		for (const row of grouped) {
			if (!row.folder || row.folder === current || (current && !row.folder.startsWith(prefix))) continue;
			const name = row.folder.slice(prefix.length).split('/')[0];
			subfolders.set(name, (subfolders.get(name) ?? 0) + row._count._all);
		}
		const files = await prisma.document.findMany({
			where: { status: 'ACTIVE', parentId: null, folder: current },
			orderBy: [{ modifiedAt: 'desc' }, { name: 'asc' }],
			take: limit,
			select: {
				id: true, name: true, kind: true, pageCount: true, extraction: true, sizeBytes: true, modifiedAt: true,
				_count: { select: { attachments: true } }
			}
		});
		const totalFiles = await prisma.document.count({ where: { status: 'ACTIVE', parentId: null, folder: current } });
		return {
			folder: current || '(root)',
			subfolders: [...subfolders].sort(([a], [b]) => a.localeCompare(b)).map(([name, documents]) => ({ name, path: `${prefix}${name}`, documents })),
			files: files.map(({ _count, ...f }) => ({ ...f, attachments: _count.attachments })),
			totalFiles,
			truncated: totalFiles > files.length
		};
	}
});

const statusTool = defineTool({
	name: 'document_source_status',
	description:
		'When the Dropbox documents were last synced and what is stored: recent sync runs, and document counts by type and readability (OK, NO_TEXT = scanned PDF needing OCR, FAILED, UNSUPPORTED). ' +
		"Example: 'are the documents up to date?' → {}.",
	inputSchema: {},
	requiredScope: SCOPE,
	handler: async () => {
		const [runs, byKind, byExtraction, removed] = await Promise.all([
			prisma.documentIngestRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5, select: { startedAt: true, finishedAt: true, status: true, force: true, counts: true, error: true } }),
			prisma.document.groupBy({ by: ['kind'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
			prisma.document.groupBy({ by: ['extraction'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
			prisma.document.count({ where: { status: 'REMOVED' } })
		]);
		const failures = await prisma.document.findMany({
			where: { status: 'ACTIVE', extraction: { in: ['FAILED', 'NO_TEXT'] } },
			select: { id: true, path: true, extraction: true, extractionNote: true, sizeBytes: true },
			take: 50
		});
		return {
			configured: isDropboxConfigured(),
			lastSuccessfulSync: runs.find((r) => r.status === 'SUCCEEDED')?.finishedAt ?? null,
			recentRuns: runs,
			documentsByKind: Object.fromEntries(byKind.map((r) => [r.kind, r._count._all])),
			documentsByReadability: Object.fromEntries(byExtraction.map((r) => [r.extraction, r._count._all])),
			removedFromDropbox: removed,
			unreadable: failures
		};
	}
});

const changesTool = defineTool({
	name: 'document_source_changes',
	description:
		'Compares the Dropbox folder with what is stored and lists what the next sync would add, update, move or mark removed. Read-only: it changes nothing. ' +
		"Example: 'has anything new been added to Dropbox since the last sync?' → {}.",
	inputSchema: {},
	requiredScope: SCOPE,
	handler: async () => {
		if (!isDropboxConfigured()) return notConfigured();
		try {
			const { root, files, plan } = await previewChanges();
			const sample = (paths: string[]) => ({ count: paths.length, paths: paths.slice(0, 50), truncated: paths.length > 50 });
			return {
				root: root.pathDisplay,
				filesInDropbox: files.length,
				added: sample(plan.added.map((p) => p.path)),
				updated: sample(plan.updated.map((p) => p.path)),
				moved: sample(plan.moved.map((p) => `${p.existing?.path} → ${p.path}`)),
				removed: sample(plan.removed.map((d) => d.path)),
				unchanged: plan.unchanged.length
			};
		} catch (error) {
			if (error instanceof DropboxError) return { error: { code: error.code, message: error.message } };
			throw error;
		}
	}
});

const placesTool = defineTool({
	name: 'document_places',
	description:
		'Map pins from KMZ/KML files in the Dropbox folder: name, description, the KML folder it sits in, geometry type, and latitude/longitude (lines and polygons also return every vertex). ' +
		"Example: 'where is the XRI tie-in point?' → { query: 'tie-in', folder: 'XRI' }.",
	inputSchema: {
		query: z.string().trim().max(200).optional().describe('Text to match in the pin name, description or KML folder.'),
		folder: z.string().max(300).optional().describe('Limit to KMZ files in this Dropbox folder.'),
		documentId: z.string().max(64).optional().describe('Limit to one KMZ file.'),
		includeVertices: z.boolean().optional().describe('Include every vertex for lines and polygons (default false).'),
		limit: z.number().int().min(1).max(500).optional().describe('Maximum pins (default 200).')
	},
	requiredScope: SCOPE,
	handler: async ({ query, folder, documentId, includeVertices = false, limit = 200 }) => {
		const where = {
			document: { status: 'ACTIVE' as const, ...(documentId ? { id: documentId } : {}), ...folderFilter(folder) },
			...(query
				? {
						OR: [
							{ name: { contains: query, mode: 'insensitive' as const } },
							{ description: { contains: query, mode: 'insensitive' as const } },
							{ kmlFolder: { contains: query, mode: 'insensitive' as const } }
						]
					}
				: {})
		};
		const [places, total] = await Promise.all([
			prisma.documentPlace.findMany({
				where,
				take: limit,
				orderBy: [{ documentId: 'asc' }, { name: 'asc' }],
				select: {
					name: true, description: true, kmlFolder: true, geometryType: true, latitude: true, longitude: true,
					coordinates: includeVertices,
					document: { select: { id: true, path: true } }
				}
			}),
			prisma.documentPlace.count({ where })
		]);
		return { places, total, truncated: total > places.length };
	}
});

export const documentTools: readonly McpToolDefinition[] = [searchTool, getTool, browseTool, statusTool, changesTool, placesTool];

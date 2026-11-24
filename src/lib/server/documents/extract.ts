import { XMLParser } from 'fast-xml-parser';
import { strFromU8, unzipSync } from 'fflate';

/**
 * Text extraction for the document source. Pure functions over bytes: no network, no
 * database, so they are unit-testable and safe to run on any file. Nothing here logs file
 * contents.
 */

export type DocumentKindName = 'PDF' | 'DOCX' | 'MSG' | 'KMZ' | 'OTHER';

export type Place = {
	name: string | null;
	description: string | null;
	kmlFolder: string | null;
	geometryType: string;
	latitude: number;
	longitude: number;
	coordinates: [number, number][] | null;
};

export type EmailMeta = {
	subject: string | null;
	from: string | null;
	to: string[];
	cc: string[];
	sentAt: string | null;
};

export type Extracted = {
	status: 'OK' | 'NO_TEXT' | 'UNSUPPORTED';
	/** Page texts, 1-based in storage. Non-PDF kinds produce a single page. */
	pages: string[];
	note?: string;
	meta?: EmailMeta;
	places?: Place[];
	/** Readable attachments of an email, extracted as their own documents by the caller. */
	attachments?: { name: string; bytes: Uint8Array }[];
};

export function kindOf(fileName: string): DocumentKindName {
	const ext = fileName.toLowerCase().split('.').pop() ?? '';
	if (ext === 'pdf') return 'PDF';
	if (ext === 'docx') return 'DOCX';
	if (ext === 'msg') return 'MSG';
	if (ext === 'kmz' || ext === 'kml') return 'KMZ';
	return 'OTHER';
}

/** Postgres text cannot hold NUL; collapse runs of blank space so pages stay compact. */
export function cleanText(text: string): string {
	return text
		.replace(/\u0000/g, '')
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t\f\v]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function stripHtml(html: string): string {
	return html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'");
}

export async function extract(kind: DocumentKindName, fileName: string, bytes: Uint8Array): Promise<Extracted> {
	switch (kind) {
		case 'PDF':
			return extractPdf(bytes);
		case 'DOCX':
			return extractDocx(bytes);
		case 'MSG':
			return extractMsg(bytes);
		case 'KMZ':
			return extractKmz(fileName, bytes);
		default:
			return { status: 'UNSUPPORTED', pages: [], note: 'File type is not read.' };
	}
}

// --- PDF ---------------------------------------------------------------------------

async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
	const { extractText, getDocumentProxy } = await import('unpdf');
	// pdf.js takes ownership of the buffer it is given; pass a copy.
	// verbosity 0 silences pdf.js font warnings ("TT: undefined function"), which are noise.
	const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
	try {
		const { text } = await extractText(pdf, { mergePages: false });
		const pages = text.map(cleanText);
		if (pages.every((page) => page === '')) {
			return { status: 'NO_TEXT', pages, note: `No text layer on ${pages.length} page(s); scanned PDF, needs OCR.` };
		}
		return { status: 'OK', pages };
	} finally {
		await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
	}
}

// --- DOCX --------------------------------------------------------------------------

async function extractDocx(bytes: Uint8Array): Promise<Extracted> {
	const mammoth = (await import('mammoth')).default;
	const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
	const text = cleanText(value);
	return text ? { status: 'OK', pages: [text] } : { status: 'NO_TEXT', pages: [''], note: 'The document has no text.' };
}

// --- MSG (Outlook email) -------------------------------------------------------------

type MsgFields = {
	subject?: string;
	senderName?: string;
	senderEmail?: string;
	body?: string;
	bodyHtml?: string;
	clientSubmitTime?: string;
	messageDeliveryTime?: string;
	creationTime?: string;
	recipients?: { name?: string; email?: string; smtpAddress?: string; recipType?: 'to' | 'cc' | 'bcc' }[];
	attachments?: { fileName?: string; innerMsgContent?: true }[];
	error?: string;
};

const ATTACHMENT_KINDS = new Set<DocumentKindName>(['PDF', 'DOCX', 'KMZ', 'MSG']);

function person(name?: string, email?: string) {
	if (name && email && name !== email) return `${name} <${email}>`;
	return name || email || null;
}

async function extractMsg(bytes: Uint8Array): Promise<Extracted> {
	const module = (await import('@kenjiuno/msgreader')) as unknown as { default: unknown };
	// CommonJS default export: under ESM it may arrive wrapped once more.
	const MsgReader = ((module.default as { default?: unknown }).default ?? module.default) as new (buffer: ArrayBuffer) => {
		getFileData(): MsgFields;
		getAttachment(attachment: MsgFields['attachments'] extends (infer A)[] | undefined ? A : never): { fileName: string; content: Uint8Array };
	};
	const copy = bytes.slice().buffer as ArrayBuffer;
	const reader = new MsgReader(copy);
	const data = reader.getFileData();
	if (data.error) return { status: 'NO_TEXT', pages: [''], note: 'Not a readable Outlook message.' };

	const recipients = data.recipients ?? [];
	const list = (type: 'to' | 'cc') =>
		recipients.filter((r) => (r.recipType ?? 'to') === type).map((r) => person(r.name, r.smtpAddress ?? r.email)).filter((v): v is string => Boolean(v));
	const sent = data.clientSubmitTime ?? data.messageDeliveryTime ?? data.creationTime ?? null;
	const sentAt = sent && !Number.isNaN(Date.parse(sent)) ? new Date(sent).toISOString() : null;
	const meta: EmailMeta = {
		subject: data.subject ?? null,
		from: person(data.senderName, data.senderEmail),
		to: list('to'),
		cc: list('cc'),
		sentAt
	};

	const body = cleanText(data.body || (data.bodyHtml ? stripHtml(data.bodyHtml) : ''));
	const attachmentNames = (data.attachments ?? []).map((a) => a.fileName).filter((n): n is string => Boolean(n));
	const header = [
		meta.subject && `Subject: ${meta.subject}`,
		meta.from && `From: ${meta.from}`,
		meta.to.length && `To: ${meta.to.join('; ')}`,
		meta.cc.length && `Cc: ${meta.cc.join('; ')}`,
		meta.sentAt && `Sent: ${meta.sentAt}`,
		attachmentNames.length && `Attachments: ${attachmentNames.join('; ')}`
	]
		.filter(Boolean)
		.join('\n');

	const attachments: { name: string; bytes: Uint8Array }[] = [];
	const skipped: string[] = [];
	for (const attachment of data.attachments ?? []) {
		if (attachment.innerMsgContent) {
			skipped.push(`${attachment.fileName ?? 'embedded message'} (embedded email)`);
			continue;
		}
		const name = attachment.fileName ?? '';
		if (!ATTACHMENT_KINDS.has(kindOf(name))) continue;
		try {
			const { content } = reader.getAttachment(attachment);
			attachments.push({ name, bytes: content });
		} catch {
			skipped.push(name);
		}
	}

	return {
		status: 'OK',
		pages: [cleanText(`${header}\n\n${body}`)],
		meta,
		attachments,
		note: skipped.length ? `Attachments not read: ${skipped.join('; ')}.` : undefined
	};
}

// --- KMZ / KML -----------------------------------------------------------------------

async function extractKmz(fileName: string, bytes: Uint8Array): Promise<Extracted> {
	let kml: string | undefined;
	if (fileName.toLowerCase().endsWith('.kml')) {
		kml = strFromU8(bytes);
	} else {
		const files = unzipSync(bytes, { filter: (file) => file.name.toLowerCase().endsWith('.kml') });
		// The main document is doc.kml by convention; otherwise the first KML in the archive.
		const names = Object.keys(files).sort((a, b) => Number(b.toLowerCase().endsWith('doc.kml')) - Number(a.toLowerCase().endsWith('doc.kml')));
		if (names.length) kml = strFromU8(files[names[0]]);
	}
	if (!kml) return { status: 'NO_TEXT', pages: [''], note: 'No KML document inside the KMZ.' };

	const places = parseKml(kml);
	if (!places.length) return { status: 'NO_TEXT', pages: [''], places, note: 'The map has no placemarks.' };
	const lines = places.map((p) =>
		[p.name ?? '(unnamed)', p.kmlFolder && `[${p.kmlFolder}]`, `${p.geometryType} at ${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`, p.description]
			.filter(Boolean)
			.join(' — ')
	);
	return { status: 'OK', pages: [cleanText(lines.join('\n'))], places };
}

type XmlNode = Record<string, unknown>;

const ARRAY_TAGS = new Set(['Document', 'Folder', 'Placemark', 'Data', 'SimpleData', 'Point', 'LineString', 'Polygon', 'LinearRing']);

function text(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value === 'object') {
		const inner = (value as XmlNode)['#text'];
		return inner === undefined ? null : String(inner);
	}
	const s = String(value).trim();
	return s === '' ? null : s;
}

function parseCoordinates(raw: unknown): [number, number][] {
	const value = text(raw);
	if (!value) return [];
	const out: [number, number][] = [];
	for (const tuple of value.trim().split(/\s+/)) {
		const [lon, lat] = tuple.split(',').map(Number);
		if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push([lon, lat]);
	}
	return out;
}

function geometryOf(node: XmlNode): { type: string; coords: [number, number][] } | null {
	const first = (key: string) => (node[key] as XmlNode[] | undefined)?.[0];
	const point = first('Point');
	if (point) return { type: 'Point', coords: parseCoordinates(point.coordinates) };
	const line = first('LineString');
	if (line) return { type: 'LineString', coords: parseCoordinates(line.coordinates) };
	const polygon = first('Polygon');
	if (polygon) {
		const ring = ((polygon.outerBoundaryIs as XmlNode | undefined)?.LinearRing as XmlNode[] | undefined)?.[0];
		return { type: 'Polygon', coords: parseCoordinates(ring?.coordinates) };
	}
	const multi = node.MultiGeometry as XmlNode | undefined;
	return multi ? geometryOf(multi) : null;
}

function extendedData(node: XmlNode): string | null {
	const ext = node.ExtendedData as XmlNode | undefined;
	if (!ext) return null;
	const pairs: string[] = [];
	for (const d of (ext.Data as XmlNode[] | undefined) ?? []) {
		const name = text(d['@_name']);
		const value = text(d.value);
		if (name && value) pairs.push(`${name}: ${value}`);
	}
	for (const schema of ((ext.SchemaData as XmlNode | XmlNode[] | undefined) ? [ext.SchemaData].flat() : []) as XmlNode[]) {
		for (const d of (schema.SimpleData as XmlNode[] | undefined) ?? []) {
			const name = text(d['@_name']);
			const value = text(d);
			if (name && value) pairs.push(`${name}: ${value}`);
		}
	}
	return pairs.length ? pairs.join('; ') : null;
}

/** Every placemark with usable coordinates: each container's own pins, then its folders' pins. */
export function parseKml(kml: string): Place[] {
	const parser = new XMLParser({
		ignoreAttributes: false,
		removeNSPrefix: true,
		isArray: (name) => ARRAY_TAGS.has(name)
	});
	const root = parser.parse(kml) as XmlNode;
	const places: Place[] = [];

	const walk = (node: XmlNode, folderPath: string[]) => {
		for (const placemark of (node.Placemark as XmlNode[] | undefined) ?? []) {
			const geometry = geometryOf(placemark);
			if (!geometry || !geometry.coords.length) continue;
			const [lon, lat] = geometry.coords[0];
			const description = [text(placemark.description), extendedData(placemark)].filter(Boolean).map((d) => cleanText(stripHtml(d!))).join(' — ');
			places.push({
				name: text(placemark.name),
				description: description || null,
				kmlFolder: folderPath.length ? folderPath.join('/') : null,
				geometryType: geometry.type,
				latitude: lat,
				longitude: lon,
				coordinates: geometry.type === 'Point' ? null : geometry.coords
			});
		}
		for (const key of ['Document', 'Folder'] as const) {
			for (const child of (node[key] as XmlNode[] | undefined) ?? []) {
				const name = key === 'Folder' ? text(child.name) : null;
				walk(child, name ? [...folderPath, name] : folderPath);
			}
		}
	};

	walk((root.kml as XmlNode | undefined) ?? root, []);
	return places;
}

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { cleanText, extract, kindOf, parseKml, stripHtml } from '../../src/lib/server/documents/extract.ts';
import { folderOf, planChanges, relativePath, toSections, type ExistingDocument } from '../../src/lib/server/documents/plan.ts';
import type { DropboxFile } from '../../src/lib/server/dropbox/client.ts';

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Lease map</name>
    <Folder>
      <name>Wells</name>
      <Placemark>
        <name>MLMU 139</name>
        <description><![CDATA[<b>Producer</b><br/>Spud 1962]]></description>
        <Point><coordinates>-103.123456,32.654321,0</coordinates></Point>
      </Placemark>
      <Folder>
        <name>Injectors</name>
        <Placemark>
          <name>MLMU 204 Injector</name>
          <ExtendedData><Data name="API"><value>30-025-12345</value></Data></ExtendedData>
          <Point><coordinates>-103.2,32.7</coordinates></Point>
        </Placemark>
      </Folder>
    </Folder>
    <Placemark>
      <name>Flowline</name>
      <LineString><coordinates>-103.1,32.6,0 -103.15,32.65,0 -103.2,32.7,0</coordinates></LineString>
    </Placemark>
    <Placemark><name>No geometry</name></Placemark>
  </Document>
</kml>`;

describe('kindOf', () => {
	it('maps the four supported extensions, case-insensitively', () => {
		expect(kindOf('Report.PDF')).toBe('PDF');
		expect(kindOf('a.docx')).toBe('DOCX');
		expect(kindOf('mail.msg')).toBe('MSG');
		expect(kindOf('map.kmz')).toBe('KMZ');
		expect(kindOf('map.kml')).toBe('KMZ');
		expect(kindOf('sheet.xlsx')).toBe('OTHER');
		expect(kindOf('noextension')).toBe('OTHER');
	});
});

describe('text cleaning', () => {
	it('removes NUL characters Postgres cannot store and collapses blank space', () => {
		expect(cleanText('a\u0000b  \t c\r\n\r\n\r\n\r\nd ')).toBe('ab c\n\nd');
	});
	it('strips HTML to text', () => {
		expect(cleanText(stripHtml('<p>Hello&nbsp;<b>world</b></p><script>x()</script>'))).toBe('Hello world');
	});
});

describe('parseKml', () => {
	const places = parseKml(KML);
	const byName = (name: string) => places.find((p) => p.name === name)!;

	it('returns every placemark with coordinates, skipping ones without geometry', () => {
		expect(places.map((p) => p.name).sort()).toEqual(['Flowline', 'MLMU 139', 'MLMU 204 Injector']);
	});
	it('reads latitude and longitude in the right order', () => {
		expect(byName('MLMU 139')).toMatchObject({ latitude: 32.654321, longitude: -103.123456, geometryType: 'Point', coordinates: null });
	});
	it('records the nested KML folder path and strips HTML from descriptions', () => {
		expect(byName('MLMU 139').kmlFolder).toBe('Wells');
		expect(byName('MLMU 139').description).toBe('Producer\nSpud 1962');
		expect(byName('MLMU 204 Injector').kmlFolder).toBe('Wells/Injectors');
		expect(byName('MLMU 204 Injector').description).toBe('API: 30-025-12345');
		expect(byName('Flowline').kmlFolder).toBeNull();
	});
	it('keeps every vertex of a line and uses the first as the representative point', () => {
		expect(byName('Flowline')).toMatchObject({ geometryType: 'LineString', latitude: 32.6, longitude: -103.1 });
		expect(byName('Flowline').coordinates).toHaveLength(3);
	});
});

describe('extract KMZ', () => {
	it('reads doc.kml from inside a KMZ archive and makes the pins searchable text', async () => {
		const kmz = zipSync({ 'files/icon.png': new Uint8Array([1, 2, 3]), 'doc.kml': strToU8(KML) });
		const result = await extract('KMZ', 'Lease map.kmz', kmz);
		expect(result.status).toBe('OK');
		expect(result.places).toHaveLength(3);
		expect(result.pages[0]).toContain('MLMU 204 Injector');
		expect(result.pages[0]).toContain('32.700000, -103.200000');
	});
	it('reports a KMZ with no KML inside as NO_TEXT rather than failing', async () => {
		const result = await extract('KMZ', 'empty.kmz', zipSync({ 'readme.txt': strToU8('hi') }));
		expect(result.status).toBe('NO_TEXT');
	});
	it('marks unsupported types without reading them', async () => {
		expect((await extract('OTHER', 'a.xlsx', new Uint8Array())).status).toBe('UNSUPPORTED');
	});
});

const root = { pathLower: '/leaco - oncor' };

function file(id: string, pathDisplay: string, contentHash = 'h1'): DropboxFile {
	return { id, name: pathDisplay.split('/').pop()!, pathDisplay, pathLower: pathDisplay.toLowerCase(), size: 10, contentHash, serverModified: '2026-11-20T00:00:00Z' };
}

function doc(sourceFileId: string, path: string, contentHash = 'h1', status: ExistingDocument['status'] = 'ACTIVE'): ExistingDocument {
	return { id: `doc-${sourceFileId}`, sourceFileId, path, contentHash, status };
}

describe('paths', () => {
	it('makes paths relative to the root folder, keeping display case', () => {
		expect(relativePath(root, file('id:1', '/LeaCo - Oncor/Daily Reports/Nov 20.pdf'))).toBe('Daily Reports/Nov 20.pdf');
	});
	it('gives the folder part, empty at the root', () => {
		expect(folderOf('Daily Reports/2026/Nov 20.pdf')).toBe('Daily Reports/2026');
		expect(folderOf('top.pdf')).toBe('');
	});
});

describe('planChanges', () => {
	const files = [
		file('id:new', '/LeaCo - Oncor/XRI/new.pdf'),
		file('id:changed', '/LeaCo - Oncor/Oncor/contract.pdf', 'h2'),
		file('id:moved', '/LeaCo - Oncor/OneOk/renamed.docx'),
		file('id:same', '/LeaCo - Oncor/Daily Reports/a.pdf'),
		file('id:back', '/LeaCo - Oncor/Daily Reports/b.pdf')
	];
	const existing = [
		doc('id:changed', 'Oncor/contract.pdf', 'h1'),
		doc('id:moved', 'OneOk/old name.docx'),
		doc('id:same', 'Daily Reports/a.pdf'),
		doc('id:gone', 'RRR Grazing Lease/lease.pdf'),
		doc('id:back', 'Daily Reports/b.pdf', 'h1', 'REMOVED'),
		doc('id:already-removed', 'x.pdf', 'h1', 'REMOVED')
	];

	it('sorts each file into exactly one bucket', () => {
		const plan = planChanges(root, files, existing);
		expect(plan.added.map((p) => p.file.id)).toEqual(['id:new', 'id:back']);
		expect(plan.updated.map((p) => p.file.id)).toEqual(['id:changed']);
		expect(plan.moved.map((p) => p.path)).toEqual(['OneOk/renamed.docx']);
		expect(plan.unchanged.map((p) => p.file.id)).toEqual(['id:same']);
		expect(plan.removed.map((d) => d.sourceFileId)).toEqual(['id:gone']);
	});
	it('re-reads every present file with force', () => {
		const plan = planChanges(root, files, existing, true);
		expect(plan.updated.map((p) => p.file.id).sort()).toEqual(['id:changed', 'id:moved', 'id:same']);
		expect(plan.unchanged).toHaveLength(0);
	});
});

describe('toSections', () => {
	it('leaves short text as one section', () => {
		expect(toSections('short', 100)).toEqual(['short']);
	});
	it('splits at paragraph boundaries without losing text', () => {
		const paragraphs = Array.from({ length: 10 }, (_, i) => `paragraph ${i} `.repeat(5).trim());
		const sections = toSections(paragraphs.join('\n\n'), 200);
		expect(sections.length).toBeGreaterThan(1);
		expect(sections.every((s) => s.length <= 200)).toBe(true);
		expect(sections.join('\n\n')).toBe(paragraphs.join('\n\n'));
	});
	it('hard-splits a single paragraph longer than the limit', () => {
		expect(toSections('x'.repeat(450), 200).map((s) => s.length)).toEqual([200, 200, 50]);
	});
});

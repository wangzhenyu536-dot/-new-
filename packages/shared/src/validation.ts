import {normalizeTitleSearch,SEARCH_INDEX_BYTES} from './query.js';
import readExcel from 'read-excel-file/universal';
import { Unzip, UnzipInflate, zipSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
export type Issue = { code: string; file?: string; sheet?: string; row?: number; column?: string; field?: string };
export type EegResult = { ok: boolean; issues: Issue[]; points?: { time: number; value: number }[]; summary?: { count: number; start: number; end: number; min: number; max: number; sheet: string } };
// Provisional local precheck limits, awaiting a real device sample.
export const PREVIEW_LIMITS = { titleChars: 160, categoryChars: 60, textChars: 100000, textBytes: 1024 * 1024, excelBytes: 5 * 1024 * 1024, expandedBytes: 25 * 1024 * 1024, zipEntries: 1000, rows: 50000, parseMs: 5000 };
export function normalizeCategory(value: unknown) {
  if (typeof value !== 'string') throw new Error('categoryInvalid');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || [...name].length > PREVIEW_LIMITS.categoryChars || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('categoryInvalid');
  return { name, normalizedName: name.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ') };
}
export function validateText(bytes: Uint8Array, file: string): { ok: boolean; text?: string; issues: Issue[] } {
  const fail = (code: string) => ({ ok: false, issues: [{ code, file }] });
  if (!/\.txt$/i.test(file)) return fail('textType');
  if (bytes.length > PREVIEW_LIMITS.textBytes) return fail('textSize');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('textEncoding'); }
  if ([...text].some(char => { const code = char.charCodeAt(0); return (code < 32 && ![9, 10, 13].includes(code)) || code === 127 || code === 65533; })) return fail('textEncoding');
  if (!text.trim()) return fail('emptyText');
  if (text.length > PREVIEW_LIMITS.textChars) return fail('textLength');
  return { ok: true, text, issues: [] };
}
export function validatePackInput(input: { title: string; categoryId: string; text: string; textFileValid: boolean; eegValid: boolean }): Issue[] {
  const issues: Issue[] = [];
  if (!input.title.trim()) issues.push({ code: 'titleRequired', field: 'title' });
  else if (input.title.length > PREVIEW_LIMITS.titleChars) issues.push({ code: 'titleLength', field: 'title' });
  if (new TextEncoder().encode(normalizeTitleSearch(input.title.trim())).length > SEARCH_INDEX_BYTES) issues.push({code:'titleSearchLength',field:'title'});
  if (!input.categoryId) issues.push({ code: 'categoryRequired', field: 'category' });
  if (!input.text.trim() && !input.textFileValid) issues.push({ code: 'textRequired', field: 'text' });
  if (input.text.length > PREVIEW_LIMITS.textChars) issues.push({ code: 'textLength', field: 'text' });
  if (!input.eegValid) issues.push({ code: 'eegRequired', field: 'eeg' });
  return issues;
}
class InvalidEeg extends Error { constructor(public issue: Issue) { super(issue.code); } }
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
function boundedUnzip(bytes: Uint8Array, limits: typeof PREVIEW_LIMITS, checkTime: () => void) {
  function bad(code: string): never { throw new InvalidEeg({ code }); }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) bad('corrupt');
  const count = view.getUint16(end + 10, true), offset = view.getUint32(end + 16, true), length = view.getUint32(end + 12, true);
  if (!count || view.getUint16(end + 8, true) !== count || offset + length !== end) bad('corrupt');
  if (count > limits.zipEntries) bad('zipEntries');
  const expected = new Map<string, { size: number; crc: number }>();
  let position = offset, declaredBytes = 0;
  for (let i = 0; i < count; i++) {
    checkTime();
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) bad('corrupt');
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true);
    const size = view.getUint32(position + 24, true), nameLength = view.getUint16(position + 28, true);
    const next = position + 46 + nameLength + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
    if (next > end || flags & 1 || ![0, 8].includes(method)) bad('corrupt');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(position + 46, position + 46 + nameLength));
    if (!name || name.startsWith('/') || /[:\\]/.test(name) || name.split('/').includes('..') || expected.has(name)) bad('corrupt');
    declaredBytes += size; if (declaredBytes > limits.expandedBytes) bad('expandedSize');
    expected.set(name, { size, crc: view.getUint32(position + 16, true) }); position = next;
  }
  if (position !== end) bad('corrupt');
  const files: Record<string, Uint8Array> = Object.create(null);
  const seen = new Set<string>(); let actualBytes = 0, completed = 0;
  const unzip = new Unzip(stream => {
    checkTime(); const metadata = expected.get(stream.name);
    if (!metadata || seen.has(stream.name)) bad('corrupt'); seen.add(stream.name);
    const chunks: Uint8Array[] = []; let size = 0, crc = -1;
    stream.ondata = (error, chunk, final) => {
      if (error) bad('corrupt'); checkTime(); size += chunk.length; actualBytes += chunk.length;
      if (actualBytes > limits.expandedBytes || size > metadata.size) bad('expandedSize');
      for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      chunks.push(chunk);
      if (final) {
        if (size !== metadata.size || ((crc ^ -1) >>> 0) !== metadata.crc) bad('corrupt');
        const data = new Uint8Array(size); let at = 0; for (const part of chunks) { data.set(part, at); at += part.length; }
        files[stream.name] = data; completed++;
      }
    };
    stream.start();
  });
  unzip.register(UnzipInflate);
  // Small compressed chunks bound transient inflate allocations as well as retained bytes.
  for (let at = 0; at < bytes.length; at += 4096) { checkTime(); unzip.push(bytes.subarray(at, at + 4096), at + 4096 >= bytes.length); }
  if (completed !== count) bad('corrupt');
  return files;
}
type XmlNode = { [key: string]: unknown };
function object(value: unknown): XmlNode { return value && typeof value === 'object' ? value as XmlNode : {}; }
function list(value: unknown): XmlNode[] { return Array.isArray(value) ? value.map(object) : value === undefined ? [] : [object(value)]; }
function hidden(value: unknown) { return value === '1' || value === 'true'; }
export async function validateEeg(bytes: Uint8Array, file: string, limits = PREVIEW_LIMITS): Promise<EegResult> {
  function fail(code: string, detail: Partial<Issue> = {}): never { throw new InvalidEeg({ code, ...detail }); }
  const started = Date.now();
  const checkTime = () => { if (Date.now() - started >= limits.parseMs) fail('parseTimeout'); };
  try {
    if (!/\.xlsx$/i.test(file)) fail('fileType');
    if (bytes.length > limits.excelBytes) fail('fileSize');
    checkTime();
    if (bytes.length < 22 || bytes[0] !== 80 || bytes[1] !== 75) fail('corrupt');
    const files = boundedUnzip(bytes, limits, checkTime);
    const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, processEntities: false, isArray: name => ['sheet', 'row', 'c', 'col'].includes(name) });
    const xml: Record<string, string> = {};
    for (const [path, data] of Object.entries(files)) if (/\.(xml|rels)$/i.test(path)) {
      checkTime(); const content = new TextDecoder('utf-8', { fatal: true }).decode(data);
      if (/<!\s*(DOCTYPE|ENTITY)/i.test(content) || XMLValidator.validate(content) !== true) fail('corrupt'); xml[path] = content;
    }
    if (!xml['[Content_Types].xml'] || !xml['xl/workbook.xml'] || Object.keys(files).some(path => /vbaProject\.bin$/i.test(path)) || !xml['[Content_Types].xml'].includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) fail('corrupt');
    const workbook = object(parser.parse(xml['xl/workbook.xml']));
    const sheets = list(object(object(workbook.workbook).sheets).sheet);
    const sheetPaths = Object.keys(xml).filter(path => /^xl\/worksheets\/[^/]+\.xml$/.test(path));
    if (sheets.length !== 1 || sheetPaths.length !== 1) fail('sheets');
    const sheet = String(sheets[0]['@_name'] ?? 'Sheet 1'), location = { sheet };
    if (sheets[0]['@_state'] && sheets[0]['@_state'] !== 'visible') fail('hidden', location);
    const sheetPath = sheetPaths[0], worksheet = object(object(parser.parse(xml[sheetPath])).worksheet);
    if (worksheet.mergeCells) fail('merged', location);
    if (list(object(worksheet.cols).col).some(col => hidden(col['@_hidden']) || hidden(col['@_collapsed']))) fail('hidden', location);
    const rows = list(object(worksheet.sheetData).row);
    let lastDataRow = 0;
    for (const row of rows) {
      checkTime(); const number = Number(row['@_r']);
      if (!Number.isSafeInteger(number) || number < 1) fail('corrupt', location);
      if (hidden(row['@_hidden']) || hidden(row['@_collapsed'])) fail('hidden', { ...location, row: number });
      const seen = new Set<string>();
      for (const cell of list(row.c)) {
        const address = String(cell['@_r'] ?? ''), match = /^([A-Z]+)([1-9]\d*)$/.exec(address);
        if (!match || Number(match[2]) !== number || seen.has(address)) fail('corrupt', location); seen.add(address);
        const column = match[1] === 'A' ? 'timestamp_ms' : match[1] === 'B' ? 'value' : match[1];
        if ('f' in cell) fail('formula', { ...location, row: number, column });
        const hasValue = 'v' in cell || 'is' in cell;
        if (!hasValue) continue;
        lastDataRow = Math.max(lastDataRow, number);
        if (!['A', 'B'].includes(match[1])) fail('headers', { ...location, row: number, column });
        if (number > 1 && (cell['@_t'] === undefined || cell['@_t'] === 'n') && 'v' in cell && !Number.isFinite(Number(cell.v))) fail('notNumeric', { ...location, row: number, column });
      }
    }
    if (lastDataRow > limits.rows + 1) fail('rowLimit', location);
    // Remove empty styled cells/rows before the reader allocates a rectangular data array.
    xml[sheetPath] = xml[sheetPath].replace(/<row\b[^>]*>[\s\S]*?<\/row>/g, row => row.replace(/<c\b[^>]*\/>/g, '').replace(/<c\b[^>]*>\s*<\/c>/g, '')).replace(/<row\b[^>]*>\s*<\/row>/g, '');
    const sanitized = { ...files, [sheetPath]: new TextEncoder().encode(xml[sheetPath]) };
    const safeBytes = zipSync(sanitized, { level: 0 });
    const parsed = await readExcel(new Uint8Array(safeBytes).buffer);
    checkTime(); const data = parsed[0]?.data;
    if (!data || data[0]?.length !== 2 || data[0][0] !== 'timestamp_ms' || data[0][1] !== 'value') fail('headers', { ...location, row: 1 });
    if (data.length - 1 < 2) fail('tooFewRows', location);
    if (data.length - 1 > limits.rows) fail('rowLimit', location);
    const points: { time: number; value: number }[] = [], issues: Issue[] = [];
    for (let index = 1; index < data.length; index++) {
      checkTime(); const row = data[index], rowNumber = index + 1;
      for (let col = 0; col < 2; col++) {
        const value = row?.[col], column = col === 0 ? 'timestamp_ms' : 'value';
        if (value === null || value === undefined || value === '') issues.push({ code: 'emptyCell', sheet, row: rowNumber, column });
        else if (typeof value !== 'number' || !Number.isFinite(value)) issues.push({ code: 'notNumeric', sheet, row: rowNumber, column });
      }
      const time = row?.[0], value = row?.[1];
      if (typeof time === 'number' && Number.isFinite(time)) {
        if (time < 0) issues.push({ code: 'negativeTime', sheet, row: rowNumber, column: 'timestamp_ms' });
        const previous = data[index - 1]?.[0];
        if (index > 1 && typeof previous === 'number' && time <= previous) issues.push({ code: 'timeOrder', sheet, row: rowNumber, column: 'timestamp_ms' });
      }
      if (typeof time === 'number' && typeof value === 'number') points.push({ time, value });
      if (issues.length >= 20) break;
    }
    if (issues.length) return { ok: false, issues: issues.map(issue => ({ ...issue, file })) };
    let min = Infinity, max = -Infinity; for (const point of points) { min = Math.min(min, point.value); max = Math.max(max, point.value); }
    return { ok: true, issues: [], points, summary: { count: points.length, start: points[0].time, end: points[points.length - 1].time, min, max, sheet } };
  } catch (error) { return { ok: false, issues: [{ ...(error instanceof InvalidEeg ? error.issue : { code: 'corrupt' }), file }] }; }
}

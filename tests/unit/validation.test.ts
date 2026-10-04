import { expect, test } from 'vitest';
import { normalizeCategory, validateEeg, validatePackInput, validateText, PREVIEW_LIMITS } from '@evertrace/shared';
import { workbook, editSheet, mutateWorkbook, validRows } from '../fixtures/workbooks.mjs';
import { strToU8 } from 'fflate';
const file = 'synthetic.xlsx';
async function rejects(rows: (string | number | null)[][], code: string, row?: number, column?: string) {
  const result = await validateEeg(await workbook(rows), file); expect(result.ok).toBe(false);
  expect(result.issues).toContainEqual(expect.objectContaining({ code, file, ...(row ? { row } : {}), ...(column ? { column } : {}) }));
}
test('valid irregular time, signed and zero values preserve original samples', async () => {
  const result = await validateEeg(await workbook(), file); expect(result.ok).toBe(true); expect(result.issues).toEqual([]);
  expect(result.points).toEqual([{ time: 0, value: -3 }, { time: 2.5, value: 0 }, { time: 7, value: 4 }]);
  expect(result.summary).toMatchObject({ count: 3, start: 0, end: 7, min: -3, max: 4, sheet: 'EEG' });
});
test('fixed headers and exactly two columns are required', async () => { await rejects([['time', 'value'], [0, 1], [2, 3]], 'headers', 1); await rejects([['timestamp_ms', 'value', 'extra'], [0, 1, 2], [2, 3, 4]], 'headers', 1); });
test('empty values report exact sheet, row and column', async () => { await rejects([validRows[0], [0, 1], [2, null], [4, 3]], 'emptyCell', 3, 'value'); });
test('strings and infinite numbers are not accepted as samples', async () => {
  await rejects([validRows[0], [0, 1], [2, '3']], 'notNumeric', 3, 'value');
  const bytes = editSheet(await workbook(), xml => xml.replace(/(<c\b[^>]*\br="B2"[^>]*>)[\s\S]*?<\/c>/, '$1<v>Infinity</v></c>'));
  const result = await validateEeg(bytes, file); expect(result.ok).toBe(false); expect(result.issues[0].code).toBe('notNumeric');
});
test('negative, repeated and out-of-order times are rejected', async () => { await rejects([validRows[0], [-1, 0], [2, 3]], 'negativeTime', 2, 'timestamp_ms'); await rejects([validRows[0], [0, 1], [0, 2]], 'timeOrder', 3, 'timestamp_ms'); await rejects([validRows[0], [2, 1], [1, 2]], 'timeOrder', 3, 'timestamp_ms'); });
test('fewer than two samples are rejected', async () => { await rejects([validRows[0], [0, 1]], 'tooFewRows'); });
test('interior blank rows fail while trailing formatting is not data', async () => {
  await rejects([validRows[0], [0, 1], [null, null], [2, 2]], 'emptyCell', 3);
  const result = await validateEeg(editSheet(await workbook(), xml => xml.replace('</sheetData>', '<row r="50"><c r="A50" s="0"/></row></sheetData>')), file); expect(result.ok).toBe(true); expect(result.summary?.count).toBe(3);
});
test.each([
  ['formula', (s: string) => s.replace(/(<c\b[^>]*\br="B2"[^>]*>)[\s\S]*?<\/c>/, '$1<f>1+2</f><v>3</v></c>')],
  ['merged', (s: string) => s.replace('</worksheet>', '<mergeCells count="1"><mergeCell ref="A2:B2"/></mergeCells></worksheet>')],
  ['hidden', (s: string) => s.replace('<row r="2"', '<row hidden="1" r="2"')],
])('structural %s is rejected even when numeric cached data exists', async (code, edit) => { const result = await validateEeg(editSheet(await workbook(), edit), file); expect(result.ok).toBe(false); expect(result.issues[0].code).toBe(code); });
test('multiple and hidden sheets are rejected', async () => {
  expect((await validateEeg(await workbook(validRows, true), file)).issues[0].code).toBe('sheets');
  const bytes = mutateWorkbook(await workbook(), files => { files['xl/workbook.xml'] = strToU8(new TextDecoder().decode(files['xl/workbook.xml']).replace('<sheet ', '<sheet state="hidden" ')); });
  expect((await validateEeg(bytes, file)).issues[0].code).toBe('hidden');
});
test('wrong extension, corrupt XLSX and XML entities are rejected', async () => {
  expect((await validateEeg(await workbook(), 'fake.xls')).issues[0].code).toBe('fileType');
  expect((await validateEeg(new Uint8Array([1, 2, 3]), file)).issues[0].code).toBe('corrupt');
  const bytes = editSheet(await workbook(), s => '<!DOCTYPE worksheet [<!ENTITY x "bad">]>' + s);
  expect((await validateEeg(bytes, file)).issues[0].code).toBe('corrupt');
});
test('compressed, expanded, entry, row and time budgets are enforced', async () => {
  const bytes = await workbook();
  for (const [change, code] of [[{ excelBytes: 10 }, 'fileSize'], [{ expandedBytes: 10 }, 'expandedSize'], [{ zipEntries: 1 }, 'zipEntries'], [{ rows: 2 }, 'rowLimit'], [{ parseMs: 0 }, 'parseTimeout']] as const) {
    expect((await validateEeg(bytes, file, { ...PREVIEW_LIMITS, ...change })).issues[0].code).toBe(code);
  }
});
test('UTF-8 and BOM text are valid; empty, invalid encoding, wrong extension and excessive files fail', () => {
  expect(validateText(new TextEncoder().encode('\ufeff中文 notes'), 'notes.txt')).toMatchObject({ ok: true, text: '中文 notes' });
  for (const [bytes, name, code] of [[new TextEncoder().encode(' \n'), 'empty.txt', 'emptyText'], [new Uint8Array([0xff]), 'bad.txt', 'textEncoding'], [new TextEncoder().encode('hello'), 'wrong.csv', 'textType'], [new Uint8Array(PREVIEW_LIMITS.textBytes + 1), 'large.txt', 'textSize']] as const) expect(validateText(bytes, name).issues[0].code).toBe(code);
});
test('pack precheck reports every required field and accepts notes or a valid text file', () => {
  const input = { title: '', categoryId: '', text: ' ', textFileValid: false, eegValid: false };
  expect(validatePackInput(input).map(x => x.code)).toEqual(['titleRequired', 'categoryRequired', 'textRequired', 'eegRequired']);
  expect(validatePackInput({ ...input, title: 'Practice', categoryId: 'category', textFileValid: true, eegValid: true })).toEqual([]);
  expect(validatePackInput({ ...input, title: 'Practice', categoryId: 'category', text: 'Notes', eegValid: true })).toEqual([]);
});
test('category normalization deduplicates Unicode/case/whitespace and rejects empty or long names', () => {
  expect(normalizeCategory('  ＦＯＣＵＳ\u3000 Training  ').normalizedName).toBe('focus training');
  expect(() => normalizeCategory('  ')).toThrow('categoryInvalid'); expect(() => normalizeCategory('a'.repeat(61))).toThrow('categoryInvalid');
});

test('truncated archives and mismatched CRC are rejected before worksheet parsing', async () => {
  const bytes = await workbook(); expect((await validateEeg(bytes.slice(0, -22), file)).issues[0].code).toBe('corrupt');
  const edited = bytes.slice(), view = new DataView(edited.buffer), end = edited.length - 22;
  const directory = view.getUint32(end + 16, true); view.setUint32(directory + 16, view.getUint32(directory + 16, true) ^ 1, true);
  expect((await validateEeg(edited, file)).issues[0].code).toBe('corrupt');
});
test('hidden columns and additional data columns are rejected', async () => {
  const bytes = await workbook(); const hidden = editSheet(bytes, s => s.replace('<sheetData>', '<cols><col min="1" max="1" hidden="1"/></cols><sheetData>'));
  expect((await validateEeg(hidden, file)).issues[0].code).toBe('hidden');
  await rejects([validRows[0], [0, 1], [2, 3, 4]], 'headers', 3, 'C');
});

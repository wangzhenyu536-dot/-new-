import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_LIMITS, validateEeg, type FileKind, type Issue } from '@evertrace/shared';
import {
  prepareSparkMaterials, SparkMaterialError, SPARK_LIMITS,
  type SparkInput, type SparkPreparationDependencies,
} from '../../apps/web/src/services/spark-materials';
import { editSheet, validRows, workbook } from '../fixtures/workbooks.mjs';

const encode = (text: string) => new TextEncoder().encode(text);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const imageDependencies: SparkPreparationDependencies = { checkImage: async () => true };
function originalFile(bytes: Uint8Array, name: string, type: string, lastModified = 0) {
  return new File([bytes.slice().buffer], name, { type, lastModified });
}
async function input(options: Partial<SparkInput> = {}): Promise<SparkInput> {
  return {
    title: 'Synthetic Spark preparation', categoryId: 'practice', textContent: 'Synthetic notes',
    attachments: [{ file: originalFile(await workbook(), 'synthetic.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), kind: 'eeg' }],
    ...options,
  };
}
function prepare(value: SparkInput, dependencies: SparkPreparationDependencies = imageDependencies) {
  return prepareSparkMaterials(value, new AbortController().signal, undefined, dependencies);
}
async function issuesFor(value: SparkInput, dependencies?: SparkPreparationDependencies) {
  try {
    await prepare(value, dependencies);
  } catch (error) {
    expect(error).toBeInstanceOf(SparkMaterialError);
    // A notImplemented placeholder is a real red, never a successful rejection.
    expect((error as SparkMaterialError).code).not.toBe('notImplemented');
    return (error as SparkMaterialError).issues;
  }
  throw new Error('Expected preparation to reject invalid materials.');
}
async function rejects(value: SparkInput, issue: Partial<Issue>, dependencies?: SparkPreparationDependencies) {
  expect(await issuesFor(value, dependencies)).toContainEqual(expect.objectContaining(issue));
}

// Real one-pixel PNG fixtures; padding uses a legal ancillary chunk and CRC.
// Pixel decoding itself is injected here and exercised in the browser suite.
function pngChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(data.length + 12), view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(encode(type), 4);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, data.length + 8)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  view.setUint32(data.length + 8, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}
function pngBytes(size?: number) {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 2;
  const chunks = [signature, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(new Uint8Array([0, 0, 0, 255])))];
  const end = pngChunk('IEND', new Uint8Array()), base = chunks.reduce((sum, chunk) => sum + chunk.length, end.length);
  if (size !== undefined) {
    if (size < base + 12) throw new Error('PNG boundary fixture is too small.');
    chunks.push(pngChunk('spAd', new Uint8Array(size - base - 12)));
  }
  chunks.push(end);
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function image(size?: number, name = 'synthetic.png') {
  return { file: originalFile(pngBytes(size), name, 'image/png'), kind: 'image' as const };
}
async function capacityInput(totalBytes: number) {
  const value = await input(), eegSize = value.attachments[0].file.size;
  let remaining = totalBytes - eegSize;
  for (let index = 0; index < 11; index++) {
    const size = Math.floor(remaining / (11 - index));
    value.attachments.push(image(size, `capacity-${index}.png`));
    remaining -= size;
  }
  expect(value.attachments).toHaveLength(12);
  expect(value.attachments.reduce((sum, attachment) => sum + attachment.file.size, 0)).toBe(totalBytes);
  expect(value.attachments.every(attachment => attachment.file.size <= SPARK_LIMITS.fileBytes)).toBe(true);
  return value;
}

describe('Spark production material preparation, without Firestore or emulator state', () => {
  it('accepts notes and real Excel with no TXT file', async () => {
    const result = await prepare(await input());
    expect(result.textContent).toBe('Synthetic notes');
    expect(result.files.map(file => file.kind)).toEqual(['eeg']);
    expect(result.submissionHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('accepts a valid UTF-8 TXT instead of notes, including the original BOM bytes', async () => {
    const value = await input({ textContent: '' });
    const bytes = encode('\ufeff中文 synthetic notes\n');
    value.attachments.push({ file: originalFile(bytes, 'notes.txt', 'text/plain'), kind: 'text' });
    const result = await prepare(value), text = result.files.find(file => file.kind === 'text')!;
    expect(result.textContent).toBe('');
    expect(Buffer.from(text.bytes)).toEqual(Buffer.from(bytes));
    expect(text.sha256).toBe(hash(bytes));
  });
  it('accepts both notes and TXT without replacing either original', async () => {
    const value = await input();
    value.attachments.push({ file: originalFile(encode('Original TXT'), 'notes.txt', 'text/plain'), kind: 'text' });
    const result = await prepare(value);
    expect(result.textContent).toBe('Synthetic notes');
    expect(new TextDecoder().decode(result.files.find(file => file.kind === 'text')!.bytes)).toBe('Original TXT');
  });
  it('rejects whitespace notes without a valid TXT', async () => {
    await rejects(await input({ textContent: ' \n\t' }), { code: 'textRequired', field: 'text' });
  });
  it('requires an EEG Excel even when notes and a valid image exist', async () => {
    await rejects(await input({ attachments: [image()] }), { code: 'eegRequired', field: 'eeg' });
  });
  it.each([
    ['bad.txt', new Uint8Array([0xff]), 'textEncoding'],
    ['empty.txt', encode(' \n\t'), 'emptyText'],
    ['notes.csv', encode('Synthetic notes'), 'textType'],
  ] as const)('rejects invalid TXT %s instead of using it to satisfy text', async (name, bytes, code) => {
    const value = await input({ textContent: '' });
    value.attachments.push({ file: originalFile(bytes, name, 'text/plain'), kind: 'text' });
    await rejects(value, { code, file: name });
  });
  it('rejects an invalid selected TXT even when notes already satisfy required text', async () => {
    const value = await input();
    value.attachments.push({ file: originalFile(new Uint8Array([0xff]), 'bad.txt', 'text/plain'), kind: 'text' });
    await rejects(value, { code: 'textEncoding', file: 'bad.txt' });
  });
  it.each([
    [[validRows[0], [0, 1], [2, null], [4, 3]], 'emptyCell', 3, 'value'],
    [[validRows[0], [2, 1], [1, 2]], 'timeOrder', 3, 'timestamp_ms'],
    [[validRows[0], [0, 1], [0, 2]], 'timeOrder', 3, 'timestamp_ms'],
    [[validRows[0], [-1, 1], [2, 2]], 'negativeTime', 2, 'timestamp_ms'],
    [[['time', 'value'], [0, 1], [2, 2]], 'headers', 1, undefined],
  ] as const)('preserves actual Excel validation details for %s', async (rows, code, row, column) => {
    const mutableRows = rows.map(values => [...values]);
    const value = await input({ attachments: [{ file: originalFile(await workbook(mutableRows), 'invalid.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), kind: 'eeg' }] });
    await rejects(value, { code, file: 'invalid.xlsx', sheet: 'EEG', row, ...(column ? { column } : {}) });
  });
  it('rejects cached numeric results from a formula cell using the real Excel parser', async () => {
    const bytes = editSheet(await workbook(), xml => xml.replace(/(<c\b[^>]*\br="B2"[^>]*>)[\s\S]*?<\/c>/, '$1<f>1+2</f><v>3</v></c>'));
    const value = await input({ attachments: [{ file: originalFile(bytes, 'formula.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), kind: 'eeg' }] });
    await rejects(value, { code: 'formula', file: 'formula.xlsx', sheet: 'EEG', row: 2, column: 'value' });
  });
  it('rejects corrupted Excel rather than accepting the filename or MIME type', async () => {
    await rejects(await input({ attachments: [{ file: originalFile(new Uint8Array([1, 2, 3]), 'corrupt.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), kind: 'eeg' }] }), { code: 'corrupt', file: 'corrupt.xlsx' });
  });
  it('rejects valid workbook bytes with the wrong extension', async () => {
    await rejects(await input({ attachments: [{ file: originalFile(await workbook(), 'wrong.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), kind: 'eeg' }] }), { code: 'fileType', file: 'wrong.xls' });
  });
  it('checks the image signature before invoking pixel decoding', async () => {
    const decode = vi.fn(async () => true), value = await input();
    value.attachments.push({ file: originalFile(encode('not an image'), 'forged.png', 'image/png'), kind: 'image' });
    await rejects(value, { code: 'imageType', file: 'forged.png' }, { checkImage: decode });
    expect(decode).not.toHaveBeenCalled();
  });
  it('requires actual decoding even when a PNG header and metadata look valid', async () => {
    const decode = vi.fn(async () => false), value = await input();
    value.attachments.push(image());
    await rejects(value, { code: 'imageInvalid', file: 'synthetic.png' }, { checkImage: decode });
    expect(decode).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledWith(value.attachments[1].file);
  });
  it('accepts PNG only after both signature checking and the injected decoder succeed', async () => {
    const decode = vi.fn(async () => true), value = await input();
    value.attachments.push(image());
    const result = await prepare(value, { checkImage: decode });
    expect(result.files.find(file => file.kind === 'image')).toMatchObject({ name: 'synthetic.png', mediaType: 'image/png' });
    expect(decode).toHaveBeenCalledOnce();
  });
  it('accepts an original exactly 512 KiB without shrinking it', async () => {
    const value = await input(); value.attachments.push(image(SPARK_LIMITS.fileBytes));
    const result = await prepare(value), original = result.files.find(file => file.kind === 'image')!;
    expect(original.size).toBe(SPARK_LIMITS.fileBytes);
    expect(original.bytes.byteLength).toBe(SPARK_LIMITS.fileBytes);
    expect(Buffer.from(original.bytes)).toEqual(Buffer.from(await value.attachments[1].file.arrayBuffer()));
  });
  it.each(['text', 'eeg', 'image'] as const)('rejects %s at 512 KiB plus one byte using the Spark size message', async kind => {
    const name = { text: 'oversized.txt', eeg: 'oversized.xlsx', image: 'oversized.png' }[kind];
    const value = await input();
    value.attachments.push({ file: originalFile(new Uint8Array(SPARK_LIMITS.fileBytes + 1), name, 'application/octet-stream'), kind });
    await rejects(value, { code: 'sparkFileSize', file: name });
  });
  it('accepts exactly 3 MiB across all 12 original attachments', async () => {
    const result = await prepare(await capacityInput(SPARK_LIMITS.totalBytes));
    expect(result.files).toHaveLength(12);
    expect(result.files.map(file => file.slot)).toEqual(Array.from({ length: 12 }, (_, slot) => String(slot)));
    expect(result.files.reduce((sum, file) => sum + file.bytes.byteLength, 0)).toBe(SPARK_LIMITS.totalBytes);
  });
  it('rejects 3 MiB plus one byte while every individual file still fits', async () => {
    await rejects(await capacityInput(SPARK_LIMITS.totalBytes + 1), { code: 'sparkAttachmentLimit' });
  });
  it('rejects a thirteenth small original even when total bytes are below 3 MiB', async () => {
    const value = await input();
    for (let index = 0; index < 12; index++) value.attachments.push(image(undefined, `image-${index}.png`));
    expect(value.attachments.reduce((sum, attachment) => sum + attachment.file.size, 0)).toBeLessThan(SPARK_LIMITS.totalBytes);
    await rejects(value, { code: 'sparkAttachmentLimit' });
  });
  it.each(['../notes.txt', 'folder\\notes.txt', `${'x'.repeat(161)}.txt`, ''])('rejects an unsafe original filename %s', async name => {
    const value = await input();
    value.attachments.push({ file: originalFile(encode('Original notes'), name, 'text/plain'), kind: 'text' });
    await rejects(value, { code: 'fileName', file: name });
  });
  it('retains every original byte and computes SHA-256 independently from filename or supplied MIME', async () => {
    const value = await input();
    value.attachments.push({ file: originalFile(encode('设备原始数值\nTXT original'), 'original.txt', 'application/octet-stream'), kind: 'text' }, image());
    const originals = await Promise.all(value.attachments.map(async attachment => new Uint8Array(await attachment.file.arrayBuffer())));
    const result = await prepare(value);
    for (const [index, original] of originals.entries()) {
      expect(result.files[index].bytes).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(result.files[index].bytes)).toEqual(Buffer.from(original));
      expect(result.files[index].size).toBe(original.byteLength);
      expect(result.files[index].sha256).toBe(hash(original));
      expect(result.files[index].name).toBe(value.attachments[index].file.name);
    }
    expect(result.files.find(file => file.kind === 'text')?.mediaType).toBe('text/plain');
  });
  it('keeps irregular millisecond samples, negative and zero raw values without resampling or unit conversion', async () => {
    const rows = [['timestamp_ms', 'value'], [0, -12.125], [2.5, 0], [7001, 42.875]];
    const bytes = await workbook(rows), value = await input({ attachments: [{ file: originalFile(bytes, 'raw-device.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), kind: 'eeg' }] });
    const prepared = await prepare(value), original = prepared.files[0];
    expect(Buffer.from(original.bytes)).toEqual(Buffer.from(bytes));
    const parsed = await validateEeg(original.bytes, original.name);
    expect(parsed.points).toEqual([{ time: 0, value: -12.125 }, { time: 2.5, value: 0 }, { time: 7001, value: 42.875 }]);
    expect(parsed.summary).toMatchObject({ count: 3, start: 0, end: 7001, min: -12.125, max: 42.875 });
  });
  it('gives identical content a stable fingerprint despite a new File object or lastModified timestamp', async () => {
    const first = await input(), bytes = new Uint8Array(await first.attachments[0].file.arrayBuffer());
    const second = { ...first, attachments: [{ file: originalFile(bytes, 'synthetic.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 12345), kind: 'eeg' as FileKind }] };
    const [a, b] = await Promise.all([prepare(first), prepare(second)]);
    expect(a.submissionHash).toBe(b.submissionHash);
  });
  it('changes the fingerprint for notes and for same-size original content changes', async () => {
    const first = await input();
    first.attachments.push({ file: originalFile(encode('alpha'), 'notes.txt', 'text/plain'), kind: 'text' });
    const notesChanged = { ...first, textContent: 'Changed notes' };
    const fileChanged = { ...first, attachments: [first.attachments[0], { file: originalFile(encode('bravo'), 'notes.txt', 'text/plain'), kind: 'text' as FileKind }] };
    expect(first.attachments[1].file.size).toBe(fileChanged.attachments[1].file.size);
    const [a, b, c] = await Promise.all([prepare(first), prepare(notesChanged), prepare(fileChanged)]);
    expect(a.submissionHash).not.toBe(b.submissionHash);
    expect(a.submissionHash).not.toBe(c.submissionHash);
  });
  it('reports a file read failure instead of treating unreadable bytes as validated', async () => {
    const value = await input(), selected = value.attachments[0].file;
    vi.spyOn(selected, 'arrayBuffer').mockRejectedValue(new Error('Synthetic read failure'));
    await rejects(value, { code: 'fileRead', file: selected.name });
  });
  it('preserves a real parser timeout issue', async () => {
    const value = await input();
    await rejects(value, { code: 'parseTimeout', file: 'synthetic.xlsx' }, { parseEeg: async (bytes, name) => validateEeg(bytes, name, { ...PREVIEW_LIMITS, parseMs: 0 }) });
  });
  it('reports a crashed parser as fileRead', async () => {
    await rejects(await input(), { code: 'fileRead', file: 'synthetic.xlsx' }, { parseEeg: async () => { throw new Error('Synthetic worker failure'); } });
  });
  it('aborts before reading or parsing rather than wrapping cancellation in a validation error', async () => {
    const value = await input(), controller = new AbortController(), parse = vi.fn(async (bytes: Uint8Array, name: string) => validateEeg(bytes, name));
    const read = vi.spyOn(value.attachments[0].file, 'arrayBuffer'); controller.abort();
    await expect(prepareSparkMaterials(value, controller.signal, undefined, { parseEeg: parse })).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled();
  });
  it('aborts during actual parsing preparation and never returns a prepared save', async () => {
    const value = await input(), controller = new AbortController();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const prepared = prepareSparkMaterials(value, controller.signal, undefined, {
      parseEeg: async (bytes, name, signal) => { enter(); await gate; signal.throwIfAborted(); return validateEeg(bytes, name); },
    });
    try {
      await Promise.race([entered, prepared.then(() => { throw new Error('Expected parser entry before completion.'); })]);
      controller.abort(); release();
      await expect(prepared).rejects.toMatchObject({ name: 'AbortError' });
    } finally { release(); }
  });
});

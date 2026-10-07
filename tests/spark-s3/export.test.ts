import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase/firestore';
import { zipSync, unzipSync, strFromU8 } from 'fflate';
import { validateEeg, type EegResult } from '@evertrace/shared';
import { workbook } from '../fixtures/workbooks.mjs';
import { SparkMaterialError, SPARK_LIMITS } from '../../apps/web/src/services/spark-materials';
import { exportSparkMaterial, type SparkExportDetail, type SparkExportDependencies } from '../../apps/web/src/services/spark-export';

const digest = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const originals = [new TextEncoder().encode('\ufeff原文 TXT 一\r\n'), new TextEncoder().encode('Original TXT two\n'), Uint8Array.from(await workbook()), Uint8Array.from(await workbook([['timestamp_ms', 'value'], [0, 9], [2.5, -2], [7, 12]]))];
  const files = await Promise.all(originals.map(async (bytes, slot) => ({ slot: String(slot), kind: slot < 2 ? 'text' as const : 'eeg' as const, name: slot < 2 ? 'same.txt' : 'same.xlsx', mediaType: slot < 2 ? 'text/plain' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: bytes.length, sha256: await digest(bytes) })));
  const detail: SparkExportDetail = { category: 'Focus Training', files, pack: { id: 'spark-pack-1', title: 'Synthetic / 原件导出', titleSearch: 'synthetic / 原件导出', textContent: 'Original notes <b>原文</b>\n', categoryId: 'focus training', ownerId: 'author', ownerName: 'Synthetic author', version: 3, status: 'ready', totalBytes: files.reduce((sum, file) => sum + file.size, 0), textFileCount: 2, imageCount: 0, eegCount: 2, submissionHash: 'a'.repeat(64), createdAt: Timestamp.fromDate(new Date('2026-10-06T00:00:00Z')), updatedAt: Timestamp.fromDate(new Date('2026-10-06T01:00:00Z')) } };
  const rendered: { result: EegResult; name: string; language: string }[] = [], read: string[] = [];
  let zips = 0;
  const dependencies: SparkExportDependencies = {
    readVersion: async () => ({ version: 3, status: 'ready', revision: Math.floor(new Date('2026-10-06T01:00:00Z').getTime()/1000)+':0' }),
    readFile: async file => { read.push(file.slot); return originals[Number(file.slot)].slice(); }, digest,
    parseEeg: (bytes, name) => validateEeg(bytes, name),
    renderPng: async (result, name, language) => { rendered.push({ result, name, language }); return new Uint8Array([137, 80, 78, 71, rendered.length]); },
    zip: async entries => { zips++; return zipSync(entries, { level: 0 }); },
  };
  return { detail, originals, dependencies, rendered, read, zipCount: () => zips };
}
const signal = () => new AbortController().signal;
const noop = () => {};
test.each(['en', 'zh-CN'])('Spark ZIP in %s retains every Byte original, duplicate names and full-range metadata', async language => {
  const f = await fixture(), progress: string[] = [];
  const result = await exportSparkMaterial(f.detail, { kind: 'zip' }, language, f.dependencies, signal(), value => progress.push(value.phase));
  expect(result.mediaType).toBe('application/zip'); expect(result.name).toMatch(/\.zip$/); expect(result.name).not.toMatch(/[/\\]/);
  const entries = unzipSync(result.bytes), manifest = JSON.parse(strFromU8(entries['manifest.json']));
  expect(Object.keys(entries)).toHaveLength(9); expect(manifest).toMatchObject({ packId: f.detail.pack.id, version: 3, language, ownerId: 'author' });
  expect(manifest.files).toHaveLength(4); expect(new Set(manifest.files.map((file: { path: string }) => file.path)).size).toBe(4);
  for (const file of manifest.files) { const slot = Number(file.id); expect(entries[file.path]).toEqual(f.originals[slot]); expect(file.sha256).toBe(await digest(f.originals[slot])); expect(file.originalName).toBe(f.detail.files[slot].name); }
  expect(strFromU8(entries['text/content.txt'])).toBe(f.detail.pack.textContent);
  expect(strFromU8(entries['README.md'])).toContain(language.startsWith('zh') ? '无物理单位' : 'without a physical unit');
  expect(manifest.waveforms).toHaveLength(2);
  for (const waveform of manifest.waveforms) expect(waveform).toMatchObject({ start: 0, end: 7, sampleCount: 3, width: 2400, height: 1000, timeUnit: 'ms', valueUnit: 'unitless device raw value' });
  expect(f.rendered.map(render => render.result.points)).toEqual([[{ time: 0, value: -3 }, { time: 2.5, value: 0 }, { time: 7, value: 4 }], [{ time: 0, value: 9 }, { time: 2.5, value: -2 }, { time: 7, value: 12 }]]);
  expect(f.rendered.every(render => render.language === language)).toBe(true); expect(progress).toContain('reading'); expect(progress).toContain('waveforms'); expect(progress.at(-1)).toBe('packing');
});
test('individual originals retain BOM, line endings, bytes and media type', async () => {
  const f = await fixture(), file = f.detail.files[0];
  const result = await exportSparkMaterial(f.detail, { kind: 'original', file }, 'en', f.dependencies, signal(), noop);
  expect(result).toEqual({ bytes: f.originals[0], name: 'same.txt', mediaType: 'text/plain' }); expect(f.rendered).toHaveLength(0); expect(f.zipCount()).toBe(0);
});
test('each Excel gets a separate PNG from real reparsed full-range raw values', async () => {
  const f = await fixture();
  for (const file of f.detail.files.filter(file => file.kind === 'eeg')) {
    const result = await exportSparkMaterial(f.detail, { kind: 'png', file }, 'zh-CN', f.dependencies, signal(), noop);
    expect(result.name).toBe('same.png'); expect(result.mediaType).toBe('image/png'); expect(result.bytes.slice(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]));
  }
  expect(f.rendered).toHaveLength(2); expect(f.rendered[0].result.summary).toMatchObject({ start: 0, end: 7, count: 3, min: -3, max: 4 }); expect(f.rendered[1].result.summary).toMatchObject({ start: 0, end: 7, count: 3, min: -2, max: 12 }); expect(f.zipCount()).toBe(0);
});
test.each(['zip', 'original', 'png'] as const)('%s refuses a pack changed before reading any original', async kind => {
  const f = await fixture(); f.dependencies.readVersion = async () => ({ version: 4, status: 'ready', revision: Math.floor(new Date('2026-10-06T01:00:00Z').getTime()/1000)+':0' });
  await expect(exportSparkMaterial(f.detail, kind === 'zip' ? { kind } : { kind, file: f.detail.files[2] }, 'en', f.dependencies, signal(), noop)).rejects.toThrow('exportChanged'); expect(f.read).toHaveLength(0); expect(f.zipCount()).toBe(0);
});
test.each(['render', 'zip'])('version changes during %s reject the complete result before download', async stage => {
  const f = await fixture(); let changed = false; f.dependencies.readVersion = async () => ({ version: changed ? 4 : 3, status: 'ready', revision: Math.floor(new Date('2026-10-06T01:00:00Z').getTime()/1000)+':0' });
  const render = f.dependencies.renderPng, zip = f.dependencies.zip;
  if (stage === 'render') f.dependencies.renderPng = async (...args) => { changed = true; return render(...args); };
  else f.dependencies.zip = async (...args) => { const result = await zip(...args); changed = true; return result; };
  await expect(exportSparkMaterial(f.detail, { kind: 'zip' }, 'en', f.dependencies, signal(), noop)).rejects.toThrow('exportChanged');
});
test.each(['missing', 'size', 'hash', 'parse', 'render'])('a %s original or failed waveform produces no partial ZIP and remains retryable', async cause => {
  const f = await fixture(), read = f.dependencies.readFile, parse = f.dependencies.parseEeg, render = f.dependencies.renderPng;
  if (cause === 'missing') f.dependencies.readFile = async () => { throw new SparkMaterialError('integrity'); };
  if (cause === 'size') f.dependencies.readFile = async () => new Uint8Array([1]);
  if (cause === 'hash') f.dependencies.readFile = async file => { const bytes = await read(file); bytes[0] ^= 1; return bytes; };
  if (cause === 'parse') f.dependencies.parseEeg = async () => ({ ok: false, issues: [{ code: 'corrupt' }] });
  if (cause === 'render') f.dependencies.renderPng = async () => { throw new Error('encoder failed'); };
  await expect(exportSparkMaterial(f.detail, { kind: 'zip' }, 'en', f.dependencies, signal(), noop)).rejects.not.toThrow('notImplemented'); expect(f.zipCount()).toBe(0);
  f.dependencies.readFile = read; f.dependencies.parseEeg = parse; f.dependencies.renderPng = render;
  expect((await exportSparkMaterial(f.detail, { kind: 'zip' }, 'en', f.dependencies, signal(), noop)).bytes.length).toBeGreaterThan(0);
});
test.each([['versionChanged', 'exportChanged'], ['integrity', 'exportIntegrity']])('Spark reader %s maps to the correct export recovery state', async (code, expected) => {
  const f = await fixture(); f.dependencies.readFile = async () => { throw new SparkMaterialError(code); };
  await expect(exportSparkMaterial(f.detail, { kind: 'original', file: f.detail.files[0] }, 'en', f.dependencies, signal(), noop)).rejects.toThrow(expected);
});
test.each(['count', 'file', 'total'])('Spark %s capacity stays at 12 originals / 512 KiB / 3 MiB rather than old Storage limits', async boundary => {
  const f = await fixture();
  if (boundary === 'count') f.detail.files = Array.from({ length: 13 }, (_, i) => ({ ...f.detail.files[i % 4], slot: String(i) }));
  if (boundary === 'file') f.detail.files[0].size = SPARK_LIMITS.fileBytes + 1;
  if (boundary === 'total') f.detail.files = Array.from({ length: 7 }, (_, i) => ({ ...f.detail.files[i % 4], slot: String(i), size: SPARK_LIMITS.fileBytes }));
  await expect(exportSparkMaterial(f.detail, { kind: 'zip' }, 'en', f.dependencies, signal(), noop)).rejects.toThrow('exportInvalid'); expect(f.read).toHaveLength(0); expect(f.zipCount()).toBe(0);
});
test('PNG cannot reinterpret a TXT as an Excel and file actions must belong to the displayed manifest', async () => {
  const f = await fixture();
  await expect(exportSparkMaterial(f.detail, { kind: 'png', file: f.detail.files[0] }, 'en', f.dependencies, signal(), noop)).rejects.toThrow('exportInvalid');
  await expect(exportSparkMaterial(f.detail, { kind: 'original', file: { ...f.detail.files[0], sha256: 'b'.repeat(64) } }, 'en', f.dependencies, signal(), noop)).rejects.toThrow('exportInvalid'); expect(f.read).toHaveLength(0);
});
test('cancel before export never begins reads or ZIP work', async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort();
  await expect(exportSparkMaterial(f.detail, { kind: 'zip' }, 'en', f.dependencies, controller.signal, noop)).rejects.toMatchObject({ name: 'AbortError' }); expect(f.read).toHaveLength(0); expect(f.zipCount()).toBe(0);
});
test('cancel pending Firestore Byte reads rejects promptly; retry starts a new complete export', async () => {
  const f = await fixture(), controller = new AbortController(), original = f.dependencies.readFile;
  let entered!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
  f.dependencies.readFile = () => { entered(); return new Promise(() => {}); };
  const exportPromise = exportSparkMaterial(f.detail, { kind: 'zip' }, 'en', f.dependencies, controller.signal, noop);
  await Promise.race([waiting, exportPromise]); controller.abort(); await expect(exportPromise).rejects.toMatchObject({ name: 'AbortError' }); expect(f.zipCount()).toBe(0);
  f.dependencies.readFile = original; expect((await exportSparkMaterial(f.detail, { kind: 'zip' }, 'en', f.dependencies, signal(), noop)).bytes.length).toBeGreaterThan(0);
}, 1000);
test.each(['original', 'png'] as const)('%s rechecks the version after preparing bytes', async kind => {
  const f = await fixture(), read = f.dependencies.readFile; let changed = false;
  f.dependencies.readVersion = async () => ({ version: changed ? 4 : 3, status: 'ready', revision: Math.floor(new Date('2026-10-06T01:00:00Z').getTime()/1000)+':0' });
  f.dependencies.readFile = async file => { const bytes = await read(file); changed = true; return bytes; };
  await expect(exportSparkMaterial(f.detail, { kind, file: f.detail.files[2] }, 'en', f.dependencies, signal(), noop)).rejects.toThrow('exportChanged');
});

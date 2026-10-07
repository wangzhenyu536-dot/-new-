import type { EegResult } from '@evertrace/shared';
import { doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import { assemblePackExport, assertExportVersion, safeDownloadName, verifiedOriginal, type ExportDependencies, type ExportFile, type ExportPack, type ExportProgress } from './export-pack';
import { digestBytes, renderFullPng, zipInWorker } from './export-render';
import { parseEegInWorker } from './eeg-worker';
import { readSparkFile, SparkMaterialError, SPARK_LIMITS, type readSparkPack, type SparkFileMeta } from './spark-materials';
export const sparkMetadataRevision=(time:{seconds:number;nanoseconds:number})=>time.seconds+':'+time.nanoseconds;
export type SparkExportDetail = Awaited<ReturnType<typeof readSparkPack>>;
export type SparkExportAction = { kind: 'zip' } | { kind: 'original' | 'png'; file: SparkFileMeta };
export type SparkExportDependencies = {
  readVersion: () => Promise<{ version: number; status: string; revision?:string } | null>;
  readFile: (file: SparkFileMeta) => Promise<Uint8Array>;
  digest: (bytes: Uint8Array) => Promise<string>;
  parseEeg: (bytes: Uint8Array, name: string, signal: AbortSignal) => Promise<EegResult>;
  renderPng: (result: EegResult, name: string, language: string, signal: AbortSignal) => Promise<Uint8Array>;
  zip: (entries: Record<string, Uint8Array>, signal: AbortSignal) => Promise<Uint8Array>;
};
export type SparkExportResult = { bytes: Uint8Array; name: string; mediaType: string };
export function sparkExportDependencies(db: Firestore, detail: SparkExportDetail): SparkExportDependencies {
  return {
    readVersion: async () => {
      const saved = await getDocFromServer(doc(db, 'packs', detail.pack.id));
      return saved.exists() ? { version: saved.get('version'), status: saved.get('status'), revision: sparkMetadataRevision(saved.get('updatedAt')) } : null;
    },
    readFile: file => readSparkFile(db, detail.pack.id, detail.pack.version, file),
    digest: digestBytes, parseEeg: parseEegInWorker, renderPng: renderFullPng, zip: zipInWorker,
  };
}
function sameFile(left: SparkFileMeta, right: SparkFileMeta) {
  return left.slot === right.slot && left.kind === right.kind && left.name === right.name && left.mediaType === right.mediaType && left.size === right.size && left.sha256 === right.sha256;
}
export async function exportSparkMaterial(detail: SparkExportDetail, action: SparkExportAction, language: string, dependencies: SparkExportDependencies, signal: AbortSignal, progress: (value: ExportProgress) => void): Promise<SparkExportResult> {
  signal.throwIfAborted();
  const { pack, files } = detail;
  if (!files.length || files.length > SPARK_LIMITS.count || files.some(file => !/^(?:[0-9]|1[01])$/.test(file.slot) || !['text', 'image', 'eeg'].includes(file.kind) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > SPARK_LIMITS.fileBytes) || new Set(files.map(file => file.slot)).size !== files.length || files.reduce((sum, file) => sum + file.size, 0) > SPARK_LIMITS.totalBytes) throw new Error('exportInvalid');
  if (action.kind !== 'zip' && (!files.some(file => sameFile(file, action.file)) || action.kind === 'png' && action.file.kind !== 'eeg')) throw new Error('exportInvalid');
  const exportPack: ExportPack = { id: pack.id, title: pack.title, category: detail.category, ownerName: pack.ownerName, ownerId: pack.ownerId, textContent: pack.textContent, createdAt: pack.createdAt.toDate().toISOString(), version: pack.version, status: pack.status, revision: sparkMetadataRevision(pack.updatedAt) };
  // The shared algorithm only needs these fields. Spark has no Storage path or generation.
  const convert = (file: SparkFileMeta): ExportFile => ({ id: file.slot, kind: file.kind, originalName: file.name, mediaType: file.mediaType, size: file.size, sha256: file.sha256, active: true });
  const adapted: ExportDependencies<ExportFile> = { ...dependencies, readFile: file => dependencies.readFile(files.find(original => original.slot === file.id)!) };
  try {
    if (action.kind === 'zip') {
      const result = await assemblePackExport(exportPack, files.map(convert), language, adapted, signal, progress);
      signal.throwIfAborted(); return { ...result, mediaType: 'application/zip' };
    }
    const file = convert(action.file);
    await assertExportVersion(exportPack, adapted.readVersion, signal);
    progress({ phase: 'reading', name: file.originalName, done: 0, total: 1 });
    let bytes = await verifiedOriginal(file, adapted, signal), name = safeDownloadName(file.originalName), mediaType = file.mediaType;
    if (action.kind === 'png') {
      progress({ phase: 'waveforms', name: file.originalName, done: 0, total: 1 });
      const parsed = await dependencies.parseEeg(bytes, file.originalName, signal); signal.throwIfAborted();
      if (!parsed.ok || !parsed.points || !parsed.summary) throw new Error('exportInvalid');
      bytes = await dependencies.renderPng(parsed, file.originalName, language, signal); signal.throwIfAborted();
      name = name.replace(/\.xlsx$/i, '') + '.png'; mediaType = 'image/png';
    }
    await assertExportVersion(exportPack, adapted.readVersion, signal); signal.throwIfAborted();
    return { bytes, name, mediaType };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof SparkMaterialError) {
      if (error.code === 'versionChanged') throw new Error('exportChanged');
      if (['integrity', 'incomplete'].includes(error.code)) throw new Error('exportIntegrity');
    }
    throw error;
  }
}

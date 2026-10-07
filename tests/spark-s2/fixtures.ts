import { createHash, randomUUID } from 'node:crypto';
import {
  Bytes, doc, getDocFromServer, runTransaction, serverTimestamp, Timestamp, writeBatch,
  type DocumentData, type DocumentReference, type FieldValue, type Firestore,
} from 'firebase/firestore';
import { normalizeTitleSearch, SEARCH_INDEX_BYTES } from '../../packages/shared/src/query';

export const S2_PROJECT = 'demo-evertrace-spark-test';
export const S2_FIRESTORE_PORT = 28090;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_PACK_BYTES = 3 * 1024 * 1024;
export const MAX_FILES = 12;
export { SEARCH_INDEX_BYTES };
export type FileKind = 'text' | 'image' | 'eeg';
export interface FileMeta {
  kind: FileKind; name: string; mediaType: string; size: number; sha256: string;
}
export interface SparkFile extends FileMeta {
  slot: string; version: number; bytes: Bytes;
}
export interface SparkGroup {
  version: number; slots: string[]; totalBytes: number; textCount: number;
  imageCount: number; eegCount: number; files: Record<string, FileMeta>;
}
export interface SparkPack {
  title: string; titleSearch: string; textContent: string; ownerId: string;
  ownerName: string; categoryId: string; version: number; status: 'ready'; totalBytes: number;
  textFileCount: number; imageCount: number; eegCount: number;
  createdAt: FieldValue | Timestamp; updatedAt: FieldValue | Timestamp; submissionHash: string;
}
export interface PackBundle {
  id: string; pack: SparkPack; groups: [SparkGroup, SparkGroup]; files: SparkFile[];
}

export function fileMeta(file: SparkFile): FileMeta {
  const { kind, name, mediaType, size, sha256 } = file;
  return { kind, name, mediaType, size, sha256 };
}
export function originalFile(slot: number, kind: FileKind, bytes: Uint8Array, version = 1): SparkFile {
  const extension = { text: 'txt', image: 'png', eeg: 'xlsx' }[kind];
  const mediaType = { text: 'text/plain', image: 'image/png', eeg: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[kind];
  return { slot: String(slot), version, kind, name: `synthetic-${slot}.${extension}`, mediaType,
    size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: Bytes.fromUint8Array(bytes) };
}
export function binaryFile(slot: number, kind: FileKind, size = 128, version = 1): SparkFile {
  // Capacity fixtures deliberately test bytes/manifest rules, not browser format validation.
  const bytes = Uint8Array.from({ length: size }, (_, offset) => (offset + slot) % 251);
  return originalFile(slot, kind, bytes, version);
}
export function bundleFromFiles(files: SparkFile[], options: Partial<SparkPack> = {}, id: string = randomUUID()): PackBundle {
  const version = options.version ?? 1;
  const groups = [0, 1].map(groupIndex => {
    const selected = files.filter(file => Number(file.slot) >= groupIndex * 6 && Number(file.slot) < (groupIndex + 1) * 6);
    return { version, slots: selected.map(file => file.slot), totalBytes: selected.reduce((sum, file) => sum + file.size, 0),
      textCount: selected.filter(file => file.kind === 'text').length,
      imageCount: selected.filter(file => file.kind === 'image').length,
      eegCount: selected.filter(file => file.kind === 'eeg').length,
      files: Object.fromEntries(selected.map(file => [file.slot, fileMeta(file)])) };
  }) as [SparkGroup, SparkGroup];
  const title = options.title ?? 'Synthetic S2 pack';
  const pack: SparkPack = { title, titleSearch: normalizeTitleSearch(title), textContent: 'Synthetic notes',
    ownerId: 'owner', ownerName: 'S2 owner', categoryId: 'active', version, status: 'ready',
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    textFileCount: files.filter(file => file.kind === 'text').length,
    imageCount: files.filter(file => file.kind === 'image').length,
    eegCount: files.filter(file => file.kind === 'eeg').length,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), submissionHash: '', ...options };
  // A fixture fingerprint is only a bounded replay key. Rules cannot recompute SHA-256.
  const content = { title: pack.title, textContent: pack.textContent, ownerId: pack.ownerId,
    categoryId: pack.categoryId, files: files.map(fileMeta) };
  pack.submissionHash = options.submissionHash ?? createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return { id, pack, groups, files };
}
export function packBundle(count = 12, size = 128, options: Partial<SparkPack> = {}, id?: string): PackBundle {
  const kinds: FileKind[] = ['text', 'image', 'eeg'];
  return bundleFromFiles(Array.from({ length: count }, (_, slot) => binaryFile(slot, kinds[slot % 3], size, options.version ?? 1)), options, id);
}
type BundleWriter = { set(reference: DocumentReference<DocumentData>, value: DocumentData): unknown };
export function addBundle(writer: BundleWriter, db: Firestore, bundle: PackBundle,
  omit: { files?: string[]; groups?: number[]; root?: boolean } = {}): void {
  if (!omit.root) writer.set(doc(db, 'packs', bundle.id), bundle.pack);
  for (let index = 0; index < 2; index++) if (!omit.groups?.includes(index)) {
    writer.set(doc(db, 'packs', bundle.id, 'groups', String(index)), bundle.groups[index]);
  }
  for (const file of bundle.files) if (!omit.files?.includes(file.slot)) {
    writer.set(doc(db, 'packs', bundle.id, 'files', file.slot), file);
  }
}
export function addCreationStat(writer: BundleWriter, db: Firestore, bundle: PackBundle, previous: {packCount?:number;revision?:number} = {}): void {
  // Empty category IDs cannot form a ledger path; submit the malformed root and manifests so rules reject them.
  if (!bundle.pack.categoryId) return;
  writer.set(doc(db, 'categoryStats', bundle.pack.categoryId), { packCount: (previous.packCount ?? 0) + 1,
    revision: (previous.revision ?? 0) + 1, packId: bundle.id, operationId: bundle.pack.submissionHash, kind: 'createPack', updatedAt: serverTimestamp() });
}
export async function commitBundle(db: Firestore, bundle: PackBundle, omit?: Parameters<typeof addBundle>[3]): Promise<void> {
  const previous = bundle.pack.categoryId ? (await getDocFromServer(doc(db, 'categoryStats', bundle.pack.categoryId))).data() ?? {} : {};
  const batch = writeBatch(db); addBundle(batch, db, bundle, omit); addCreationStat(batch, db, bundle, previous); await batch.commit();
}
// Rule-level transaction fixture; production helper and browser paths are independently tested.
export async function createOnce(db: Firestore, bundle: PackBundle): Promise<{ id: string; created: boolean }> {
  const target = doc(db, 'packs', bundle.id);
  try {
    return await runTransaction(db, async transaction => {
      const existing = await transaction.get(target);
      if (existing.exists()) {
        if (existing.get('ownerId') !== bundle.pack.ownerId || existing.get('submissionHash') !== bundle.pack.submissionHash) {
          throw new Error('attemptConflict');
        }
        return { id: bundle.id, created: false };
      }
      const previous = bundle.pack.categoryId ? (await transaction.get(doc(db, 'categoryStats', bundle.pack.categoryId))).data() ?? {} : {};
      addBundle(transaction, db, bundle); addCreationStat(transaction, db, bundle, previous);
      return { id: bundle.id, created: true };
    });
  } catch (error) {
    // A concurrent immutable create can report PERMISSION_DENIED instead of ABORTED.
    // Confirm the actual committed server record; never infer success from a cached result.
    try {
      const committed = await getDocFromServer(target);
      if (committed.exists() && committed.get('status') === 'ready'
        && committed.get('ownerId') === bundle.pack.ownerId && committed.get('submissionHash') === bundle.pack.submissionHash) {
        return { id: bundle.id, created: false };
      }
    } catch {
      // Keep the original transaction error if the committed result cannot be confirmed.
    }
    throw error;
  }
}
export async function seedProfiles(db: Firestore): Promise<void> {
  const batch = writeBatch(db);
  for (const uid of ['owner', 'viewer', 'admin']) batch.set(doc(db, 'users', uid), {
    uid, displayName: `S2 ${uid}`, email: `${uid}@example.test`, role: uid === 'admin' ? 'admin' : 'member',
  });
  for (const status of ['active', 'other', 'migrating', 'deleted']) batch.set(doc(db, 'categories', status), {
    name: status[0].toUpperCase() + status.slice(1), status: status === 'other' ? 'active' : status,
    createdBy: 'owner', createdAt: Timestamp.fromMillis(1),
  });
  for (const id of ['active', 'other', 'migrating', 'deleted']) {
    batch.set(doc(db, 'categoryStats', id), { packCount: 0, revision: 0, packId: '', operationId: '', kind: 'init', updatedAt: Timestamp.fromMillis(1) });
    batch.set(doc(db, 'categoryKeys', id), { categoryId: id });
  }
  batch.set(doc(db, 'system', 'roles'), { adminCount: 1, revision: 0, changedUid: '', fromRole: 'member', toRole: 'member', operationId: '' });
  await batch.commit();
}

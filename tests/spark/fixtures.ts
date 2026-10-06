import { createHash, randomUUID } from 'node:crypto';
import {
  Bytes, doc, getDoc, runTransaction, writeBatch,
  type Firestore, type WriteBatch,
} from 'firebase/firestore';

export const SPARK_PROJECT = 'demo-evertrace-spark-s0';
export const SPARK_PORT = 28080;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_PACK_BYTES = 3 * 1024 * 1024;
export const MAX_FILES = 12;
export type FileKind = 'text' | 'image' | 'eeg';
export type Role = 'member' | 'admin';
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
  categoryId: string; version: number; status: 'ready'; totalBytes: number;
  textFileCount: number; imageCount: number; eegCount: number;
}
export interface PackBundle {
  id: string; pack: SparkPack; groups: [SparkGroup, SparkGroup]; files: SparkFile[];
}

export function fileMeta(file: SparkFile): FileMeta {
  const { kind, name, mediaType, size, sha256 } = file;
  return { kind, name, mediaType, size, sha256 };
}
export function binaryFile(slot: number, kind: FileKind, size = 128, version = 1): SparkFile {
  // Capacity fixtures are synthetic bytes, not a real image or Excel parser validation.
  const bytes = Uint8Array.from({ length: size }, (_, offset) => (offset + slot) % 251);
  return originalFile(slot, kind, bytes, version);
}
export function originalFile(slot: number, kind: FileKind, bytes: Uint8Array, version = 1): SparkFile {
  const extension = { text: 'txt', image: 'png', eeg: 'xlsx' }[kind];
  const mediaType = { text: 'text/plain', image: 'image/png', eeg: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[kind];
  return { slot: String(slot), version, kind, name: `synthetic-${slot}.${extension}`, mediaType,
    size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: Bytes.fromUint8Array(bytes) };
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
  const pack: SparkPack = { title: 'Synthetic S0 pack', titleSearch: 'synthetic s0 pack', textContent: 'Synthetic notes',
    ownerId: 'owner', categoryId: 'active', version, status: 'ready',
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    textFileCount: files.filter(file => file.kind === 'text').length,
    imageCount: files.filter(file => file.kind === 'image').length,
    eegCount: files.filter(file => file.kind === 'eeg').length, ...options };
  return { id, pack, groups, files };
}
export function packBundle(count = 12, size = 128, options: Partial<SparkPack> = {}, id?: string): PackBundle {
  const kinds: FileKind[] = ['text', 'image', 'eeg'];
  return bundleFromFiles(Array.from({ length: count }, (_, slot) => binaryFile(slot, kinds[slot % 3], size, options.version ?? 1)), options, id);
}
export function addBundle(batch: WriteBatch, db: Firestore, bundle: PackBundle,
  omit: { files?: string[]; groups?: number[] } = {}): void {
  batch.set(doc(db, 's0Packs', bundle.id), bundle.pack);
  for (let index = 0; index < 2; index++) if (!omit.groups?.includes(index)) {
    batch.set(doc(db, 's0Packs', bundle.id, 'groups', String(index)), bundle.groups[index]);
  }
  for (const file of bundle.files) if (!omit.files?.includes(file.slot)) {
    batch.set(doc(db, 's0Packs', bundle.id, 'files', file.slot), file);
  }
}
export function commitBundle(db: Firestore, bundle: PackBundle, omit?: Parameters<typeof addBundle>[3]): Promise<void> {
  const batch = writeBatch(db); addBundle(batch, db, bundle, omit); return batch.commit();
}
export async function seedProfiles(db: Firestore, adminCount = 1): Promise<void> {
  const batch = writeBatch(db);
  for (const uid of ['owner', 'viewer', 'admin', 'admin2']) batch.set(doc(db, 's0Users', uid), {
    uid, displayName: `S0 ${uid}`, email: `${uid}@example.test`,
    role: uid === 'admin' || (uid === 'admin2' && adminCount === 2) ? 'admin' : 'member',
  });
  batch.set(doc(db, 's0Categories', 'active'), { name: 'Active category', status: 'active' });
  batch.set(doc(db, 's0Categories', 'other'), { name: 'Other category', status: 'active' });
  batch.set(doc(db, 's0Categories', 'migrating'), { name: 'Migrating category', status: 'migrating' });
  batch.set(doc(db, 's0Categories', 'deleted'), { name: 'Deleted category', status: 'deleted' });
  batch.set(doc(db, 's0System', 'roles'), { adminCount, revision: 0, changedUid: '', fromRole: 'member', toRole: 'member', operationId: '' });
  await batch.commit();
}

export interface RoleReceipt {
  uid: string; actorId: string; fromRole: Role; toRole: Role; revision: number;
}
export async function changeRole(db: Firestore, actorUid: string, targetUid: string, toRole: Role,
  operationId: string = randomUUID(), expectedRole?: Role): Promise<RoleReceipt> {
  return runTransaction(db, async transaction => {
    const rolesRef = doc(db, 's0System', 'roles');
    const targetRef = doc(db, 's0Users', targetUid);
    const receiptRef = doc(db, 's0RoleOps', operationId);
    const [roles, target, receipt] = await Promise.all([
      transaction.get(rolesRef), transaction.get(targetRef), transaction.get(receiptRef),
    ]);
    if (receipt.exists()) {
      const previous = receipt.data() as RoleReceipt;
      if (previous.actorId !== actorUid || previous.uid !== targetUid || previous.toRole !== toRole) throw new Error('Operation reuse');
      return previous;
    }
    const fromRole = target.get('role') as Role;
    if (expectedRole && expectedRole !== fromRole) throw new Error('Role changed');
    if (fromRole === toRole) throw new Error('Role unchanged');
    const revision = (roles.get('revision') as number) + 1;
    const adminCount = (roles.get('adminCount') as number) + (toRole === 'admin' ? 1 : -1);
    const result: RoleReceipt = { uid: targetUid, actorId: actorUid, fromRole, toRole, revision };
    transaction.update(targetRef, { role: toRole });
    transaction.set(rolesRef, { adminCount, revision, changedUid: targetUid, fromRole, toRole, operationId });
    transaction.set(receiptRef, result);
    return result;
  });
}
export async function readRole(db: Firestore, uid: string): Promise<Role> {
  return (await getDoc(doc(db, 's0Users', uid))).get('role') as Role;
}

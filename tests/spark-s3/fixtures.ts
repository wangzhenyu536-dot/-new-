import { createHash } from 'node:crypto';
import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp, writeBatch, type Firestore, type Transaction, type WriteBatch } from 'firebase/firestore';
import { bundleFromFiles, binaryFile, originalFile, addBundle, type PackBundle, type SparkFile, type SparkPack } from '../spark-s2/fixtures';
export { MAX_FILE_BYTES, MAX_PACK_BYTES, packBundle, commitBundle, createOnce, seedProfiles } from '../spark-s2/fixtures';
export const S3_PROJECT = 'demo-evertrace-spark-test';
export const S3_FIRESTORE_PORT = 28090;
export { binaryFile, originalFile, bundleFromFiles };
export type { PackBundle, SparkFile, SparkPack };
export type EditOmit = { files?: string[]; groups?: number[]; root?: boolean; deletes?: string[]; extraDeletes?: string[] };

export function editBundle(previous: PackBundle, files: SparkFile[], options: Partial<SparkPack> = {}): PackBundle {
  const version = previous.pack.version + 1;
  const next = bundleFromFiles(files.map(file => ({ ...file, version })), {
    title: `Edited version ${version}`, textContent: previous.pack.textContent, ownerId: previous.pack.ownerId,
    ownerName: previous.pack.ownerName, categoryId: previous.pack.categoryId, createdAt: previous.pack.createdAt,
    version, updatedAt: serverTimestamp(), ...options,
  }, previous.id);
  // The version-specific submission fingerprint supports an explicit save of unchanged content.
  const input = { packId: next.id, expectedVersion: previous.pack.version, title: next.pack.title,
    categoryId: next.pack.categoryId, textContent: next.pack.textContent,
    files: next.files.map(({ slot, kind, name, size, mediaType, sha256 }) => ({ slot, kind, name, size, mediaType, sha256 })) };
  next.pack.submissionHash = options.submissionHash ?? createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return next;
}
export function replacementFiles(count: number, size = 128, version = 2): SparkFile[] {
  const kinds = ['text', 'image', 'eeg'] as const;
  return Array.from({ length: count }, (_, slot) => originalFile(slot, kinds[slot % 3],
    Uint8Array.from({ length: size }, (_, offset) => (offset + slot + version * 17) % 251), version));
}
export function addEdit(writer: WriteBatch | Transaction, db: Firestore, previous: PackBundle, next: PackBundle, omit: EditOmit = {}): void {
  addBundle(writer, db, next, omit);
  const nextSlots = new Set(next.files.map(file => file.slot));
  for (const file of previous.files) if (!nextSlots.has(file.slot) && !omit.deletes?.includes(file.slot)) {
    writer.delete(doc(db, 'packs', next.id, 'files', file.slot));
  }
  for (const slot of omit.extraDeletes ?? []) writer.delete(doc(db, 'packs', next.id, 'files', slot));
}
export function addMoveStats(writer: {set(reference:ReturnType<typeof doc>,value:Record<string,unknown>):unknown}, db: Firestore, previous: PackBundle, next: PackBundle, source: {packCount:number;revision:number}, target: {packCount:number;revision:number}): void {
  const value = (stat: {packCount:number;revision:number}, delta:number) => ({packCount:(stat?.packCount??0)+delta,revision:(stat?.revision??0)+1,packId:next.id,operationId:next.pack.submissionHash,kind:'movePack',updatedAt:serverTimestamp()});
  writer.set(doc(db,'categoryStats',previous.pack.categoryId),value(source,-1));writer.set(doc(db,'categoryStats',next.pack.categoryId),value(target,1));
}
export async function commitEdit(db: Firestore, previous: PackBundle, next: PackBundle, omit?: EditOmit): Promise<void> {
  const moved = previous.pack.categoryId !== next.pack.categoryId;
  const counters = moved ? await Promise.all([getDocFromServer(doc(db,'categoryStats',previous.pack.categoryId)),getDocFromServer(doc(db,'categoryStats',next.pack.categoryId))]) : [];
  const batch = writeBatch(db); addEdit(batch, db, previous, next, omit);
  if(moved) addMoveStats(batch,db,previous,next,counters[0].data() as {packCount:number;revision:number},counters[1].data() as {packCount:number;revision:number});
  await batch.commit();
}
// Rule integration fixture, separate from the production edit adapter's own regression tests.
export async function editTransaction(db: Firestore, previous: PackBundle, next: PackBundle): Promise<number> {
  return runTransaction(db, async transaction => {
    const current = await transaction.get(doc(db, 'packs', previous.id));
    if (!current.exists() || current.get('version') !== previous.pack.version) throw new Error('versionChanged');
    const moved = previous.pack.categoryId !== next.pack.categoryId;
    const counters = moved ? await Promise.all([transaction.get(doc(db,'categoryStats',previous.pack.categoryId)),transaction.get(doc(db,'categoryStats',next.pack.categoryId))]) : [];
    addEdit(transaction, db, previous, next);
    if(moved) addMoveStats(transaction,db,previous,next,counters[0].data() as {packCount:number;revision:number},counters[1].data() as {packCount:number;revision:number});
    return next.pack.version;
  });
}
export async function storedBundle(db: Firestore, source: PackBundle): Promise<PackBundle> {
  const pack = (await getDocFromServer(doc(db, 'packs', source.id))).data() as SparkPack;
  return { ...source, pack };
}
export async function snapshotBundle(db: Firestore, id: string) {
  const [pack, groups, files] = await Promise.all([
    getDocFromServer(doc(db, 'packs', id)),
    getDocsFromServer(collection(db, 'packs', id, 'groups')),
    getDocsFromServer(collection(db, 'packs', id, 'files')),
  ]);
  return { pack: pack.data(), groups: groups.docs.map(value => ({ id: value.id, data: value.data() })).sort((a, b) => a.id.localeCompare(b.id)),
    files: files.docs.map(value => ({ id: value.id, data: value.data() })).sort((a, b) => Number(a.id) - Number(b.id)) };
}

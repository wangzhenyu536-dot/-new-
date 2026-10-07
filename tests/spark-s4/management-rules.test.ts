import { readFileSync } from 'node:fs';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { assertFails,assertSucceeds,initializeTestEnvironment,type RulesTestContext,type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection,deleteDoc,doc,getDocFromServer,getDocsFromServer,query,serverTimestamp,setDoc,Timestamp,where,writeBatch,type Firestore } from 'firebase/firestore';
import { S4_PROJECT,S4_FIRESTORE_PORT,seedS4,seedPack,packBundle,commitCategory,createCounted,editCounted,editBundle,emptyStat,beginDelete,clearGroup,finishDelete,trustedDeleting,packOperationId,categoryOperationId,beginMigration,moveLockedPack,finishMigration,trustedMigration,renameCategory,freshCategoryId,snapshotBundle,type PackBundle } from './fixtures';
let env:RulesTestEnvironment;
const firestore=(context:RulesTestContext):Firestore=>(context.firestore() as unknown as {_delegate:Firestore})._delegate;
const client=(uid:string)=>firestore(env.authenticatedContext(uid,{email:`${uid}@example.test`}));
const anonymous=()=>firestore(env.unauthenticatedContext());
async function trusted<T>(action:(db:Firestore)=>Promise<T>):Promise<T>{let result!:T;await env.withSecurityRulesDisabled(async context=>{result=await action(firestore(context));});return result;}
const seeded=(count=12)=>trusted(db=>seedPack(db,packBundle(count)));
const capture=(id:string)=>trusted(db=>snapshotBundle(db,id));
const get=(db:Firestore,collection:string,id:string)=>getDocFromServer(doc(db,collection,id));
const stats=(id='active')=>trusted(async db=>(await get(db,'categoryStats',id)).data()!);
async function pending(previous:PackBundle){await trusted(db=>trustedDeleting(db,previous));}
async function clearAll(db:Firestore,id:string){await clearGroup(db,id,0);await clearGroup(db,id,1);}
async function locked(){await trusted(db=>trustedMigration(db));}
async function rejectUnchanged(previous:PackBundle,action:()=>Promise<unknown>){const before=await capture(previous.id),beforeStats=await stats(previous.pack.categoryId);await assertFails(action());expect(await capture(previous.id)).toEqual(before);expect(await stats(previous.pack.categoryId)).toEqual(beforeStats);}
beforeAll(async()=>{
 if(process.env.FIRESTORE_EMULATOR_HOST!==`127.0.0.1:${S4_FIRESTORE_PORT}`)throw new Error('S4 requires isolated Firestore 28090');
 env=await initializeTestEnvironment({projectId:S4_PROJECT,firestore:{host:'127.0.0.1',port:S4_FIRESTORE_PORT,rules:readFileSync(new URL('../../firebase/spark.rules',import.meta.url),'utf8')}});
});
beforeEach(async()=>{await env.clearFirestore();await trusted(db=>seedS4(db));});
afterAll(async()=>{if(env){await env.clearFirestore();await env.cleanup();}});

describe('S4 counting and canonical name registry cannot be forged',()=>{
 it('creates a category, unique canonical key and zero baseline atomically as a member',async()=>{
  await assertSucceeds(commitCategory(client('owner'),'Brain Data'));
  expect((await get(client('viewer'),'categoryKeys','brain data')).data()).toEqual({categoryId:'brain data'});
  expect((await get(client('viewer'),'categoryStats','brain data')).data()).toMatchObject({...emptyStat(),updatedAt:expect.any(Timestamp)});
 });
 it('requires both the registry and zero-count ledger when a category is created',async()=>{
  for(const missing of ['key','stats']){const db=client('owner'),batch=writeBatch(db),id=`without ${missing}`;
   batch.set(doc(db,'categories',id),{name:id,status:'active',createdBy:'owner',createdAt:serverTimestamp()});
   if(missing!=='key')batch.set(doc(db,'categoryKeys',id),{categoryId:id});if(missing!=='stats')batch.set(doc(db,'categoryStats',id),emptyStat());
   await assertFails(batch.commit());expect((await trusted(db=>get(db,'categories',id))).exists()).toBe(false);
  }
 });
 it('counts a full twelve-original create in the same atomic commit and keeps all originals readable',async()=>{
  const bundle=packBundle(12,256*1024);await assertSucceeds(createCounted(client('owner'),bundle));
  expect(await stats()).toMatchObject({packCount:1,revision:1,packId:bundle.id,kind:'createPack',operationId:bundle.pack.submissionHash});
  expect((await getDocsFromServer(collection(client('viewer'),'packs',bundle.id,'files'))).docs).toHaveLength(12);
 });
 it('moves a full 12-original 3 MiB edit across active categories with both fresh counters within rule access limits',async()=>{
  const previous=await seeded(),next=editBundle(previous,packBundle(12,256*1024).files,{categoryId:'other'});await assertSucceeds(editCounted(client('owner'),previous,next));
  expect((await stats('active')).packCount).toBe(0);expect(await stats('other')).toMatchObject({packCount:1,revision:1,packId:previous.id,kind:'movePack',operationId:next.pack.submissionHash});
  expect((await capture(previous.id)).files).toHaveLength(12);expect((await get(client('viewer'),'packs',previous.id)).get('version')).toBe(2);
 });
 it('rejects independent count changes, count resets and a counterfeit browser baseline for an old category',async()=>{
  const previous=await seeded(3),db=client('admin');
  await assertFails(setDoc(doc(db,'categoryStats','active'),{...emptyStat(),packCount:0,revision:1,packId:previous.id,kind:'deletePack',operationId:'fake'}));
  await trusted(db=>deleteDoc(doc(db,'categoryStats','other')));
  await assertFails(setDoc(doc(db,'categoryStats','other'),emptyStat()));
  expect((await get(db,'categoryStats','other')).exists()).toBe(false);expect((await stats()).packCount).toBe(1);
 });
 it('rejects registry hijacking, anonymous reads and unknown collections',async()=>{
  await assertFails(setDoc(doc(client('admin'),'categoryKeys','active'),{categoryId:'other'}));
  for(const db of [anonymous(),client('unregistered')])for(const name of ['categoryKeys','categoryStats'])await assertFails(get(db,name,'active'));
  await assertFails(setDoc(doc(client('admin'),'adminOverrides','backdoor'),{allow:true}));
 });
});

describe('S4 deletion immediately revokes access and precisely clears originals',()=>{
 it.each(['owner','admin'])('lets %s start deletion without altering its version or identity',async actor=>{
  const previous=await seeded(),db=client(actor);await assertSucceeds(beginDelete(db,previous,actor));
  const root=await get(db,'packs',previous.id),operation=await get(db,'sparkOperations',packOperationId(previous.id));
  expect(root.data()).toMatchObject({status:'deleting',version:previous.pack.version,ownerId:'owner',deletionOperation:packOperationId(previous.id)});
  expect(operation.data()).toMatchObject({kind:'deletePack',status:'pending',ownerId:'owner',actorId:actor,packId:previous.id,expectedVersion:1,moved:0});
  expect((await stats()).packCount).toBe(1);
 });
 it('hides a deleting root, file bytes and listing from other members while owner/admin can inspect its cleanup groups',async()=>{
  const previous=await seeded();await pending(previous);
  for(const db of [client('viewer'),anonymous()]){
   await assertFails(get(db,'packs',previous.id));await assertFails(getDocFromServer(doc(db,'packs',previous.id,'files','0')));await assertFails(getDocFromServer(doc(db,'packs',previous.id,'groups','0')));
  }
  const visible=await getDocsFromServer(query(collection(client('viewer'),'packs'),where('status','==','ready')));expect(visible.docs).toHaveLength(0);
  for(const uid of ['owner','admin']){await assertSucceeds(getDocFromServer(doc(client(uid),'packs',previous.id,'groups','0')));await assertFails(getDocFromServer(doc(client(uid),'packs',previous.id,'files','0')));}
 });
 it.each(['viewer','unregistered'])('rejects %s attempting to start another creator deletion',async actor=>{
  const previous=await seeded();await rejectUnchanged(previous,()=>beginDelete(client(actor),previous,actor));
 });
 it('rejects anonymous deletion without leaving an operation record',async()=>{const previous=await seeded();await rejectUnchanged(previous,()=>beginDelete(anonymous(),previous));expect((await trusted(db=>get(db,'sparkOperations',packOperationId(previous.id)))).exists()).toBe(false);});
 it('rejects missing or counterfeit operation ownership, version, actor and operation id',async()=>{
  const previous=await seeded();
  for(const options of [{omitOperation:true},{operation:{ownerId:'viewer'}},{operation:{actorId:'admin'}},{operation:{expectedVersion:2}},{operationId:'unrelated'},{root:{version:2}},{root:{title:'Changed while deleting'}}])await rejectUnchanged(previous,()=>beginDelete(client('owner'),previous,'owner',options));
 });
 it('allows a different current administrator to resume both groups and finish all twelve originals',async()=>{
  const previous=await seeded();await pending(previous);const db=client('admin2');await assertSucceeds(clearAll(db,previous.id));await assertSucceeds(finishDelete(db,previous.id));
  const snapshot=await capture(previous.id);expect(snapshot).toEqual({pack:undefined,groups:[],files:[]});
  expect(await stats()).toMatchObject({packCount:0,revision:1,packId:previous.id,kind:'deletePack',operationId:packOperationId(previous.id)});
  expect((await get(client('owner'),'sparkOperations',packOperationId(previous.id))).get('status')).toBe('done');
 });
 it('rejects group deletion when even one of its six originals remains',async()=>{
  const previous=await seeded();await pending(previous);const before=await capture(previous.id);await assertFails(clearGroup(client('owner'),previous.id,1,{keep:['11']}));expect(await capture(previous.id)).toEqual(before);
 });
 it('rejects final root deletion before both groups and their originals are absent',async()=>{
  const previous=await seeded();await pending(previous);await assertSucceeds(clearGroup(client('owner'),previous.id,0));await assertFails(finishDelete(client('owner'),previous.id));
  expect((await capture(previous.id)).files).toHaveLength(6);expect((await stats()).packCount).toBe(1);
 });
 it('forbids changing or removing originals independently while the parent remains ready',async()=>{
  const previous=await seeded(3);await rejectUnchanged(previous,()=>deleteDoc(doc(client('owner'),'packs',previous.id,'files','0')));await rejectUnchanged(previous,()=>deleteDoc(doc(client('admin'),'packs',previous.id,'groups','0')));
 });
 it('forbids other members cleaning or reading another creator pending operation',async()=>{
  const previous=await seeded();await pending(previous);await assertFails(clearGroup(client('viewer'),previous.id,0));await assertFails(get(client('viewer'),'sparkOperations',packOperationId(previous.id)));
 });
 it('requires the final decrement and completed receipt in the same commit and keeps failed cleanup resumable',async()=>{
  const previous=await seeded();await pending(previous);await clearAll(client('owner'),previous.id);await assertFails(finishDelete(client('owner'),previous.id,{omitStats:true}));
  expect((await get(client('owner'),'sparkOperations',packOperationId(previous.id))).get('status')).toBe('pending');expect((await stats()).packCount).toBe(1);
  await assertSucceeds(finishDelete(client('owner'),previous.id));
 });
 it('keeps completed receipts immutable and prevents recreation of a permanently deleted pack id',async()=>{
  const previous=await seeded();await pending(previous);await clearAll(client('owner'),previous.id);await finishDelete(client('owner'),previous.id);
  const operation=doc(client('owner'),'sparkOperations',packOperationId(previous.id));await assertFails(setDoc(operation,{...(await getDocFromServer(operation)).data(),status:'pending'}));await assertFails(deleteDoc(operation));
  await assertFails(createCounted(client('owner'),previous));expect((await trusted(db=>get(db,'packs',previous.id))).exists()).toBe(false);expect((await stats()).packCount).toBe(0);
 });
});

describe('S4 classification rename and locked migration preserve authoritative references',()=>{
 it('renames the stable category id atomically with canonical registry release and acquisition',async()=>{
  await assertSucceeds(renameCategory(client('admin'),'active','Renamed Category'));
  expect((await get(client('viewer'),'categories','active')).get('name')).toBe('Renamed Category');
  expect((await get(client('viewer'),'categoryKeys','active')).exists()).toBe(false);expect((await get(client('viewer'),'categoryKeys','renamed category')).data()).toEqual({categoryId:'active'});
  expect((await stats()).packCount).toBe(0);
 });
 it('allows the released old name to be reused with a fresh UUID while its original canonical root remains occupied',async()=>{
  await trusted(db=>renameCategory(db,'active','Renamed Category'));const id=freshCategoryId();await assertSucceeds(commitCategory(client('owner'),'Active','owner',id));
  expect((await get(client('viewer'),'categoryKeys','active')).data()).toEqual({categoryId:id});expect((await get(client('viewer'),'categories','active')).get('name')).toBe('Renamed Category');
 });
 it('deduplicates concurrent attempts to acquire the same rename key',async()=>{
  const results=await Promise.allSettled([renameCategory(client('admin'),'active','Shared Name'),renameCategory(client('admin2'),'other','Shared Name')]);
  expect(results.filter(value=>value.status==='fulfilled')).toHaveLength(1);expect(results.filter(value=>value.status==='rejected')).toHaveLength(1);
  const key=(await get(client('viewer'),'categoryKeys','shared name')).get('categoryId');expect(['active','other']).toContain(key);
 });
 it('rejects a member rename, duplicate name, missing key changes or changes to immutable creator/time',async()=>{
  for(const action of [()=>renameCategory(client('owner'),'active','New Name'),()=>renameCategory(client('admin'),'active','Other'),()=>renameCategory(client('admin'),'active','New Name',{omitOldKey:true}),()=>renameCategory(client('admin'),'active','New Name',{omitNewKey:true}),()=>renameCategory(client('admin'),'active','New Name',{data:{createdBy:'admin'}}),()=>renameCategory(client('admin'),'active','New Name',{data:{createdAt:Timestamp.fromMillis(2)}})])await assertFails(action());
  expect((await get(client('viewer'),'categories','active')).get('name')).toBe('Active');
 });
 it('locks both categories and starts the unique administrator operation atomically',async()=>{
  await assertSucceeds(beginMigration(client('admin')));expect((await get(client('viewer'),'categories','active')).data()).toMatchObject({status:'migrating',operationId:'category-active'});expect((await get(client('viewer'),'categories','other')).data()).toMatchObject({status:'locked',operationId:'category-active'});
  expect((await get(client('admin'),'sparkOperations','category-active')).data()).toMatchObject({kind:'deleteCategory',status:'pending',sourceId:'active',targetId:'other',moved:0});
 });
 it('deletes an empty category without requiring a target and keeps its completed name-reuse receipt readable',async()=>{
  await assertSucceeds(beginMigration(client('admin'),'active',''));await assertSucceeds(finishMigration(client('admin')));
  for(const name of ['categories','categoryStats','categoryKeys'])expect((await get(client('viewer'),name,'active')).exists()).toBe(false);
  expect((await get(client('viewer'),'sparkOperations','category-active')).data()).toMatchObject({status:'done',targetId:'',kind:'deleteCategory'});
  const id=freshCategoryId();await assertSucceeds(commitCategory(client('owner'),'Active','owner',id));expect((await get(client('viewer'),'categoryKeys','active')).get('categoryId')).toBe(id);
 });
 it('refuses a target-free category deletion while an existing pack still contributes to its ledger',async()=>{await seeded(3);await assertFails(beginMigration(client('admin'),'active',''));expect((await get(client('viewer'),'categories','active')).get('status')).toBe('active');});
 it('refuses a source-only lock, nonadmin migration, self migration or forged actor',async()=>{
  for(const action of [()=>beginMigration(client('admin'),'active','other','admin',{omitTarget:true}),()=>beginMigration(client('owner'),'active','other','owner'),()=>beginMigration(client('admin'),'active','active'),()=>beginMigration(client('admin'),'active','other','admin',{operation:{actorId:'admin2'}})])await assertFails(action());
  expect((await get(client('viewer'),'categories','active')).get('status')).toBe('active');
 });
 it('refuses normal pack creation into either locked classification',async()=>{
  await locked();for(const categoryId of ['active','other'])await assertFails(createCounted(client('owner'),packBundle(3,128,{categoryId})));expect((await stats('active')).packCount).toBe(0);expect((await stats('other')).packCount).toBe(0);
 });
 it('rejects a normal creator edit into or out of locked categories without changing count or originals',async()=>{
  const previous=await seeded();await locked();const next=editBundle(previous,previous.files,{categoryId:'other'});await rejectUnchanged(previous,()=>editCounted(client('owner'),previous,next));
 });
 it('moves only root classification metadata while preserving version, digest, complete originals and creation time',async()=>{
  const previous=await seeded(),before=await capture(previous.id);await locked();await assertSucceeds(moveLockedPack(client('admin'),previous.id));const after=await capture(previous.id);
  expect(after.groups).toEqual(before.groups);expect(after.files).toEqual(before.files);
  expect(after.pack).toMatchObject({...before.pack,categoryId:'other',updatedAt:expect.any(Timestamp)});expect(after.pack?.version).toBe(1);expect(after.pack?.submissionHash).toBe(previous.pack.submissionHash);
  expect(await stats('active')).toMatchObject({packCount:0,revision:1,kind:'movePack',packId:previous.id,operationId:'category-active'});expect(await stats('other')).toMatchObject({packCount:1,revision:1,kind:'movePack',packId:previous.id,operationId:'category-active'});expect((await get(client('admin'),'sparkOperations','category-active')).get('moved')).toBe(1);
 });
 it('rejects migration metadata attempts by the creator and rejects changing immutable pack data',async()=>{
  const previous=await seeded();await locked();for(const action of [()=>moveLockedPack(client('owner'),previous.id),()=>moveLockedPack(client('admin'),previous.id,'active','other',{root:{version:2}}),()=>moveLockedPack(client('admin'),previous.id,'active','other',{root:{title:'Migration overwrite'}}),()=>moveLockedPack(client('admin'),previous.id,'active','other',{root:{ownerId:'admin'}})])await rejectUnchanged(previous,action);
 });
 it('rejects a migration move missing either counter or its authoritative operation progress',async()=>{
  const previous=await seeded();await locked();for(const omit of [{omitSource:true},{omitTarget:true},{omitOperation:true}])await rejectUnchanged(previous,()=>moveLockedPack(client('admin'),previous.id,'active','other',omit));
 });
 it('prevents operation progress from increasing without the bound single pack move',async()=>{
  await locked();const db=client('admin'),ref=doc(db,'sparkOperations','category-active');await assertFails(setDoc(ref,{...(await getDocFromServer(ref)).data(),moved:1}));
 });
 it('rejects source completion while its authoritative count is nonzero',async()=>{
  const previous=await seeded();await locked();await assertFails(finishMigration(client('admin')));expect((await get(client('viewer'),'categories','active')).exists()).toBe(true);expect((await get(client('viewer'),'packs',previous.id)).get('categoryId')).toBe('active');
 });
 it('finishes an empty source only while releasing key, removing zero ledger, unlocking target and completing its receipt',async()=>{
  await locked();for(const omit of [{omitStats:true},{omitKey:true},{omitTarget:true}])await assertFails(finishMigration(client('admin'),'active',omit));
  await assertSucceeds(finishMigration(client('admin')));for(const name of ['categories','categoryStats','categoryKeys'])expect((await get(client('viewer'),name,'active')).exists()).toBe(false);
  expect((await get(client('viewer'),'categories','other')).data()).toMatchObject({status:'active'});expect((await get(client('viewer'),'categories','other')).get('operationId')).toBeUndefined();expect((await get(client('admin'),'sparkOperations','category-active')).get('status')).toBe('done');
 });
 it('concurrent moves of the same pack count it once and leave no dangling source after final completion',async()=>{
  const previous=await seeded();await locked();const results=await Promise.allSettled([moveLockedPack(client('admin'),previous.id),moveLockedPack(client('admin2'),previous.id)]);
  expect(results.filter(value=>value.status==='fulfilled')).toHaveLength(1);expect(results.filter(value=>value.status==='rejected')).toHaveLength(1);
  expect((await stats('active')).packCount).toBe(0);expect((await stats('other')).packCount).toBe(1);await assertSucceeds(finishMigration(client('admin2')));
  expect((await getDocsFromServer(query(collection(client('viewer'),'packs'),where('categoryId','==','active'),where('status','==','ready')))).docs).toHaveLength(0);expect((await get(client('viewer'),'packs',previous.id)).get('categoryId')).toBe('other');
 });
 it('lets a previously pending deletion complete within locked categories instead of leaving a stuck count',async()=>{
  const previous=await seeded();await pending(previous);await locked();await assertSucceeds(clearAll(client('owner'),previous.id));await assertSucceeds(finishDelete(client('owner'),previous.id));expect((await stats()).packCount).toBe(0);await assertSucceeds(finishMigration(client('admin')));
 });
 it('forbids finishing receipts, restoring the source or deleting unrelated categories by direct requests',async()=>{
  const db=client('admin');await assertFails(deleteDoc(doc(db,'categories','active')));await assertFails(deleteDoc(doc(db,'categoryStats','active')));await locked();const ref=doc(db,'sparkOperations',categoryOperationId('active'));await assertFails(setDoc(ref,{...(await getDocFromServer(ref)).data(),status:'done'}));
 });
});

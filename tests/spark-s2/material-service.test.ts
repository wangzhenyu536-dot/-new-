import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {initializeTestEnvironment,type RulesTestEnvironment,type RulesTestContext} from '@firebase/rules-unit-testing';
import {Bytes,collection,doc,getDocs,serverTimestamp,setDoc,type Firestore} from 'firebase/firestore';
import {seedS1, seedCategoryState,S1_PROJECT,S1_FIRESTORE_PORT} from '../spark-s1/fixtures';
import {workbook} from '../fixtures/workbooks.mjs';
import {saveSparkMaterials,readSparkPack,readSparkFile,listSparkPacks,type SparkInput,type SparkAttempt} from '../../apps/web/src/services/spark-materials';
let env:RulesTestEnvironment;
const modular=(context:RulesTestContext)=>(context.firestore() as unknown as {_delegate:Firestore})._delegate;
const client=(uid:string)=>modular(env.authenticatedContext(uid,{email:`${uid}@example.test`}));
const trusted=(action:(db:Firestore)=>Promise<void>)=>env.withSecurityRulesDisabled(context=>action(modular(context)));
beforeAll(async()=>{if(process.env.FIRESTORE_EMULATOR_HOST!==`127.0.0.1:${S1_FIRESTORE_PORT}`)throw new Error('S2 requires isolated test Firestore');env=await initializeTestEnvironment({projectId:S1_PROJECT,firestore:{host:'127.0.0.1',port:S1_FIRESTORE_PORT,rules:readFileSync('firebase/spark.rules','utf8')}});});
beforeEach(async()=>{await env.clearFirestore();await trusted(async db=>{await seedS1(db);await seedCategoryState(db,'focus training','Focus Training');});});
afterAll(async()=>{await env?.clearFirestore();await env?.cleanup();});
async function input():Promise<SparkInput>{return {title:'Synthetic S2 original service',categoryId:'focus training',textContent:'Notes kept exactly.\n设备原始值',attachments:[{kind:'eeg',file:new File([Uint8Array.from(await workbook()).buffer],'original.xlsx')},{kind:'text',file:new File(['TXT original\n第二成员'],'original.txt')}]};}
const count=async()=>{let result=0;await trusted(async db=>{result=(await getDocs(collection(db,'packs'))).size;});return result;};
it('the real adapter atomically saves originals and another member reads every byte and parsed metadata',async()=>{
 const source=await input(),attempt={current:null as SparkAttempt|null};const {packId}=await saveSparkMaterials(client('member'),'member',source,attempt,()=>{},new AbortController().signal);
 const loaded=await readSparkPack(client('viewer'),packId);expect(loaded.pack.title).toBe(source.title);expect(loaded.pack.ownerId).toBe('member');expect(loaded.pack.ownerName).toBe('Spark member');expect(loaded.pack.textContent).toBe(source.textContent);expect(loaded.pack.createdAt.toMillis()).toBeGreaterThan(0);expect(loaded.category).toBe('Focus Training');expect(loaded.files).toHaveLength(2);
 for(const [index,file] of loaded.files.entries())expect(await readSparkFile(client('viewer'),packId,1,file)).toEqual(new Uint8Array(await source.attachments[index].file.arrayBuffer()));
 expect((await listSparkPacks(client('viewer'))).map(pack=>pack.id)).toEqual([packId]);expect(await count()).toBe(1);
});
it('a completed submission can be retried with the same attempt without duplicate packs or changing timestamps',async()=>{
 const source=await input(),attempt={current:null as SparkAttempt|null},db=client('member');const first=await saveSparkMaterials(db,'member',source,attempt,()=>{},new AbortController().signal),before=await readSparkPack(db,first.packId);const second=await saveSparkMaterials(db,'member',source,attempt,()=>{},new AbortController().signal),after=await readSparkPack(db,second.packId);expect(second).toEqual(first);expect(after.pack.createdAt.toMillis()).toBe(before.pack.createdAt.toMillis());expect(after.pack.version).toBe(1);expect(await count()).toBe(1);
});
it('changed input starts a new submission rather than treating a different pack as an idempotent retry',async()=>{
 const source=await input(),attempt={current:null as SparkAttempt|null},db=client('member');const first=await saveSparkMaterials(db,'member',source,attempt,()=>{},new AbortController().signal);const second=await saveSparkMaterials(db,'member',{...source,textContent:'New notes'},attempt,()=>{},new AbortController().signal);expect(second.packId).not.toBe(first.packId);expect(await count()).toBe(2);
});
it('cancelling before preparation writes no pack and leaves a fresh submission usable',async()=>{
 const source=await input(),attempt={current:null as SparkAttempt|null},controller=new AbortController();controller.abort();await expect(saveSparkMaterials(client('member'),'member',source,attempt,()=>{},controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(await count()).toBe(0);await saveSparkMaterials(client('member'),'member',source,attempt,()=>{},new AbortController().signal);expect(await count()).toBe(1);
});
it('a category failure publishes no partial pack and retry after the category is restored succeeds once',async()=>{
 const source=await input(),attempt={current:null as SparkAttempt|null};await trusted(db=>setDoc(doc(db,'categories','focus training'),{name:'Focus Training',status:'migrating',createdBy:'member',createdAt:serverTimestamp()}));await expect(saveSparkMaterials(client('member'),'member',source,attempt,()=>{},new AbortController().signal)).rejects.toThrow('categoryUnavailable');expect(await count()).toBe(0);await trusted(db=>setDoc(doc(db,'categories','focus training'),{name:'Focus Training',status:'active',createdBy:'member',createdAt:serverTimestamp()}));await saveSparkMaterials(client('member'),'member',source,attempt,()=>{},new AbortController().signal);expect(await count()).toBe(1);
});
it('reads detect original-byte corruption instead of supplying a changed download',async()=>{
 const attempt={current:null as SparkAttempt|null};const {packId}=await saveSparkMaterials(client('member'),'member',await input(),attempt,()=>{},new AbortController().signal);const loaded=await readSparkPack(client('viewer'),packId);const file=loaded.files[0];await trusted(db=>setDoc(doc(db,'packs',packId,'files',file.slot),{bytes:Bytes.fromUint8Array(new Uint8Array(file.size))},{merge:true}));await expect(readSparkFile(client('viewer'),packId,1,file)).rejects.toThrow('integrity');
});
it('a missing group makes the detail explicitly incomplete rather than showing a partially saved pack',async()=>{
 const attempt={current:null as SparkAttempt|null};const {packId}=await saveSparkMaterials(client('member'),'member',await input(),attempt,()=>{},new AbortController().signal);await trusted(db=>setDoc(doc(db,'packs',packId,'groups','1'),{version:99},{merge:true}));await expect(readSparkPack(client('viewer'),packId)).rejects.toThrow('incomplete');
});
it('two simultaneous real adapter submissions with one attempt confirm the same complete immutable pack',async()=>{
 const source=await input(),attempt={current:null as SparkAttempt|null};const results=await Promise.all([saveSparkMaterials(client('member'),'member',source,attempt,()=>{},new AbortController().signal),saveSparkMaterials(client('member'),'member',source,attempt,()=>{},new AbortController().signal)]);expect(results[0]).toEqual(results[1]);expect(await count()).toBe(1);const saved=await readSparkPack(client('viewer'),results[0].packId);expect(saved.files).toHaveLength(2);for(const file of saved.files)expect(await readSparkFile(client('viewer'),results[0].packId,1,file)).toHaveLength(file.size);
});

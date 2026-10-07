import { randomUUID } from 'node:crypto';
import { doc, getDocFromServer, runTransaction, serverTimestamp, Timestamp, writeBatch, type DocumentData, type DocumentReference, type FieldValue, type Firestore } from 'firebase/firestore';
import { addEdit } from '../spark-s3/fixtures';
import { addBundle, seedProfiles, type PackBundle } from '../spark-s2/fixtures';
export { packBundle, bundleFromFiles, binaryFile, originalFile, type PackBundle } from '../spark-s2/fixtures';
export { editBundle, snapshotBundle, storedBundle } from '../spark-s3/fixtures';
export const S4_PROJECT='demo-evertrace-spark-test', S4_FIRESTORE_PORT=28090;
export type CategoryStat={packCount:number;revision:number;packId:string;operationId:string;kind:'init'|'createPack'|'movePack'|'deletePack';updatedAt:FieldValue|Timestamp};
export const emptyStat=():CategoryStat=>({packCount:0,revision:0,packId:'',operationId:'',kind:'init',updatedAt:serverTimestamp()});
export const packOperationId=(id:string)=>`pack-${id}`;
export const categoryOperationId=(id:string)=>`category-${id}`;
export function categoryData(name:string,uid='owner'){return {name,status:'active',createdBy:uid,createdAt:serverTimestamp()};}
export async function seedS4(db:Firestore){
 await seedProfiles(db);
 const batch=writeBatch(db);
 for(const id of ['active','other']){batch.set(doc(db,'categoryStats',id),emptyStat());batch.set(doc(db,'categoryKeys',id),{categoryId:id});}
 batch.set(doc(db,'users','admin2'),{uid:'admin2',displayName:'S4 admin2',email:'admin2@example.test',role:'admin'});
 batch.set(doc(db,'system','roles'),{adminCount:2,revision:0,changedUid:'',fromRole:'member',toRole:'member',operationId:''});
 await batch.commit();
}
export async function seedPack(db:Firestore,bundle:PackBundle):Promise<PackBundle>{
 const ref=doc(db,'categoryStats',bundle.pack.categoryId),previous=(await getDocFromServer(ref)).data() as CategoryStat;
 const batch=writeBatch(db);addBundle(batch,db,bundle);batch.set(ref,{...previous,packCount:previous.packCount+1});await batch.commit();
 const pack=(await getDocFromServer(doc(db,'packs',bundle.id))).data() as PackBundle['pack'];return {...bundle,pack};
}
export async function commitCategory(db:Firestore,name:string,uid='owner',id=name.toLowerCase()){
 const batch=writeBatch(db);batch.set(doc(db,'categories',id),categoryData(name,uid));batch.set(doc(db,'categoryKeys',name.toLowerCase()),{categoryId:id});batch.set(doc(db,'categoryStats',id),emptyStat());await batch.commit();return id;
}
export async function createCounted(db:Firestore,bundle:PackBundle,operationId=bundle.pack.submissionHash){
 await runTransaction(db,async tx=>{
  const ref=doc(db,'categoryStats',bundle.pack.categoryId),previous=(await tx.get(ref)).data() as CategoryStat;
  addBundle(tx,db,bundle);tx.set(ref,{packCount:previous.packCount+1,revision:previous.revision+1,packId:bundle.id,operationId,kind:'createPack',updatedAt:serverTimestamp()});
 });
}
export function deletionOperation(previous:PackBundle,actorId='owner'):DocumentData{
 return {kind:'deletePack',status:'pending',ownerId:previous.pack.ownerId,actorId,packId:previous.id,sourceId:'',targetId:'',categoryId:previous.pack.categoryId,expectedVersion:previous.pack.version,moved:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
}
export function addDeleteStart(writer:{set(reference:DocumentReference<DocumentData>,value:DocumentData):unknown},db:Firestore,previous:PackBundle,actorId='owner',options:{root?:DocumentData;operation?:DocumentData;operationId?:string;omitOperation?:boolean}={}){
 const operationId=options.operationId??packOperationId(previous.id);
 writer.set(doc(db,'packs',previous.id),{...previous.pack,status:'deleting',updatedAt:serverTimestamp(),deletionOperation:operationId,...options.root});
 if(!options.omitOperation)writer.set(doc(db,'sparkOperations',operationId),{...deletionOperation(previous,actorId),...options.operation});
}
export async function beginDelete(db:Firestore,previous:PackBundle,actorId='owner',options?:Parameters<typeof addDeleteStart>[4]){const batch=writeBatch(db);addDeleteStart(batch,db,previous,actorId,options);await batch.commit();}
export async function clearGroup(db:Firestore,id:string,group:number,options:{keep?:string[];omitGroup?:boolean}={}){
 const batch=writeBatch(db),groupRef=doc(db,'packs',id,'groups',String(group)),before=await getDocFromServer(groupRef);
 for(const slot of (before.get('slots')??[]) as string[])if(!options.keep?.includes(slot))batch.delete(doc(db,'packs',id,'files',slot));
 if(!options.omitGroup&&before.exists())batch.delete(groupRef);
 await batch.commit();
}
export async function finishDelete(db:Firestore,id:string,options:{omitStats?:boolean;operation?:DocumentData}={}){
 await runTransaction(db,async tx=>{
  const root=doc(db,'packs',id),operationRef=doc(db,'sparkOperations',packOperationId(id)),current=await tx.get(root),operation=await tx.get(operationRef);
  const statRef=doc(db,'categoryStats',String(current.get('categoryId'))),previous=(await tx.get(statRef)).data() as CategoryStat;
  tx.delete(root);
  if(!options.omitStats)tx.set(statRef,{packCount:previous.packCount-1,revision:previous.revision+1,packId:id,operationId:packOperationId(id),kind:'deletePack',updatedAt:serverTimestamp()});
  tx.set(operationRef,{...operation.data(),status:'done',updatedAt:serverTimestamp(),...options.operation});
 });
}
export async function renameCategory(db:Firestore,id:string,name:string,options:{omitOldKey?:boolean;omitNewKey?:boolean;data?:DocumentData}={}){
 await runTransaction(db,async tx=>{
  const root=doc(db,'categories',id),before=(await tx.get(root)).data()!;
  tx.set(root,{...before,name,...options.data});
  if(name.toLowerCase()!==String(before.name).toLowerCase()){
   if(!options.omitOldKey)tx.delete(doc(db,'categoryKeys',String(before.name).toLowerCase()));
   if(!options.omitNewKey)tx.set(doc(db,'categoryKeys',name.toLowerCase()),{categoryId:id});
  }
 });
}
export function migrationOperation(sourceId='active',targetId='other',actorId='admin'):DocumentData{return {kind:'deleteCategory',status:'pending',ownerId:actorId,actorId,packId:'',sourceId,targetId,categoryId:sourceId,expectedVersion:0,moved:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};}
export async function beginMigration(db:Firestore,sourceId='active',targetId='other',actorId='admin',options:{omitTarget?:boolean;operation?:DocumentData}={}){
 await runTransaction(db,async tx=>{
  const source=doc(db,'categories',sourceId),target=targetId?doc(db,'categories',targetId):null,[beforeSource,beforeTarget]=await Promise.all([tx.get(source),target?tx.get(target):Promise.resolve(null)]),operationId=categoryOperationId(sourceId);
  tx.set(source,{...beforeSource.data(),status:'migrating',operationId});
  if(!options.omitTarget&&target&&beforeTarget)tx.set(target,{...beforeTarget.data(),status:'locked',operationId});
  tx.set(doc(db,'sparkOperations',operationId),{...migrationOperation(sourceId,targetId,actorId),...options.operation});
 });
}
export async function moveLockedPack(db:Firestore,id:string,sourceId='active',targetId='other',options:{omitSource?:boolean;omitTarget?:boolean;omitOperation?:boolean;root?:DocumentData}={}){
 await runTransaction(db,async tx=>{
  const root=doc(db,'packs',id),source=doc(db,'categoryStats',sourceId),target=doc(db,'categoryStats',targetId),opId=categoryOperationId(sourceId),operationRef=doc(db,'sparkOperations',opId);
  const [before,sourceValue,targetValue,operation]=await Promise.all([tx.get(root),tx.get(source),tx.get(target),tx.get(operationRef)]);
  tx.set(root,{...before.data(),categoryId:targetId,updatedAt:serverTimestamp(),...options.root});
  const next=(stat:CategoryStat,delta:number):CategoryStat=>({packCount:stat.packCount+delta,revision:stat.revision+1,packId:id,operationId:opId,kind:'movePack',updatedAt:serverTimestamp()});
  if(!options.omitSource)tx.set(source,next(sourceValue.data() as CategoryStat,-1));
  if(!options.omitTarget)tx.set(target,next(targetValue.data() as CategoryStat,1));
  if(!options.omitOperation)tx.set(operationRef,{...operation.data(),moved:Number(operation.get('moved'))+1,updatedAt:serverTimestamp()});
 });
}
export async function finishMigration(db:Firestore,sourceId='active',options:{omitStats?:boolean;omitKey?:boolean;omitTarget?:boolean;operation?:DocumentData}={}){
 await runTransaction(db,async tx=>{
  const source=doc(db,'categories',sourceId),opId=categoryOperationId(sourceId),opRef=doc(db,'sparkOperations',opId),[before,operation]=await Promise.all([tx.get(source),tx.get(opRef)]),target=operation.get('targetId')?doc(db,'categories',String(operation.get('targetId'))):null,targetValue=target?await tx.get(target):null;
  tx.delete(source);if(!options.omitStats)tx.delete(doc(db,'categoryStats',sourceId));if(!options.omitKey)tx.delete(doc(db,'categoryKeys',String(before.get('name')).toLowerCase()));
  if(!options.omitTarget&&target&&targetValue){const next=targetValue.data()!;delete next.operationId;tx.set(target,{...next,status:'active'});}
  tx.set(opRef,{...operation.data(),status:'done',updatedAt:serverTimestamp(),...options.operation});
 });
}
export async function trustedDeleting(db:Firestore,previous:PackBundle,actorId='owner'){
 const batch=writeBatch(db);addDeleteStart(batch,db,previous,actorId);await batch.commit();
 // Fix timestamps to actual committed values rather than using client estimates.
 return (await getDocFromServer(doc(db,'sparkOperations',packOperationId(previous.id)))).data()!;
}
export async function trustedMigration(db:Firestore,sourceId='active',targetId='other'){await beginMigration(db,sourceId,targetId);}
export const freshCategoryId=()=>randomUUID();
export const fixedTime=Timestamp.fromMillis(1);

export async function editCounted(db:Firestore,previous:PackBundle,next:PackBundle){
 await runTransaction(db,async tx=>{
  const source=doc(db,'categoryStats',previous.pack.categoryId),target=doc(db,'categoryStats',next.pack.categoryId),[beforeSource,beforeTarget]=await Promise.all([tx.get(source),tx.get(target)]);
  addEdit(tx,db,previous,next);
  if(previous.pack.categoryId!==next.pack.categoryId){
   const change=(before:CategoryStat,delta:number):CategoryStat=>({packCount:before.packCount+delta,revision:before.revision+1,packId:next.id,operationId:next.pack.submissionHash,kind:'movePack',updatedAt:serverTimestamp()});
   tx.set(source,change(beforeSource.data() as CategoryStat,-1));tx.set(target,change(beforeTarget.data() as CategoryStat,1));
  }
 });
}

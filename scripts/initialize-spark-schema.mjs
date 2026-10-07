import { FieldValue, Timestamp } from 'firebase-admin/firestore';
const canonical = name => {
 if(typeof name!=='string')throw Error('Category name is inconsistent.');
 const value=name.trim().replace(/\s+/gu,' ');
 if(!value||[...value].length>60||/[/\\\p{Cc}]/u.test(value)||value==='.'||value==='..')throw Error('Category name is inconsistent.');
 return value.toLowerCase();
};
// Trusted operator-only preparation; browser administrators cannot manufacture a baseline.
// All queries and writes share one transaction, and existing documents are preserved.
export async function initializeSparkSchema(db) {
 return db.runTransaction(async tx=>{
  const [categories,packs,stats,keys,operations]=await Promise.all(['categories','packs','categoryStats','categoryKeys','sparkOperations'].map(id=>tx.get(db.collection(id))));
  if(operations.docs.some(d=>d.get('status')==='pending'))throw Error('Finish pending operations before schema preparation.');
  if(categories.size>150)throw Error('Prepare larger datasets with a reviewed migration before proceeding.');
  const names=new Map(),counts=new Map(categories.docs.map(d=>[d.id,0])),existingStats=new Map(stats.docs.map(d=>[d.id,d])),existingKeys=new Map(keys.docs.map(d=>[d.id,d]));
  for(const category of categories.docs){
   if(category.get('status')!=='active')throw Error('Category state is inconsistent.');
   const name=canonical(category.get('name'));if(names.has(name))throw Error('Category names must be unique before preparation.');names.set(name,category.id);
  }
  for(const pack of packs.docs){const id=pack.get('categoryId');if(!counts.has(id)||!['ready','deleting'].includes(pack.get('status')))throw Error('A saved pack reference is inconsistent.');counts.set(id,counts.get(id)+1);}
  for(const stat of stats.docs){const value=stat.data();if(!counts.has(stat.id)||value.packCount!==counts.get(stat.id)||!Number.isSafeInteger(value.revision)||value.revision<0||Object.keys(value).length!==6||typeof value.packId!=='string'||typeof value.operationId!=='string'||!['init','createPack','movePack','deletePack'].includes(value.kind)||!(value.updatedAt instanceof Timestamp))throw Error('An initialized category ledger is inconsistent.');}
  for(const key of keys.docs)if(names.get(key.id)!==key.get('categoryId')||Object.keys(key.data()).length!==1)throw Error('A category name reservation is inconsistent.');
  let createdStats=0,createdKeys=0;
  for(const category of categories.docs){
   const name=canonical(category.get('name'));
   if(!existingStats.has(category.id)){tx.create(db.doc('categoryStats/'+category.id),{packCount:counts.get(category.id),revision:0,packId:'',operationId:'',kind:'init',updatedAt:FieldValue.serverTimestamp()});createdStats++;}
   if(!existingKeys.has(name)){tx.create(db.doc('categoryKeys/'+name),{categoryId:category.id});createdKeys++;}
  }
  return {categories:categories.size,packs:packs.size,createdStats,createdKeys};
 });
}

import type { User } from 'firebase/auth';
import { doc, getDocFromServer, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { emptySparkStat, sparkStat } from './spark-ledger';
export type SparkProfile = {uid:string;email:string;displayName:string;role:'member'|'admin'};
export function validSparkProfile(value: unknown, uid: string): value is SparkProfile {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return Object.keys(data).sort().join(',') === 'displayName,email,role,uid' && data.uid === uid
    && typeof data.email === 'string' && data.email.length > 0 && data.email.length <= 254
    && typeof data.displayName === 'string' && data.displayName.length > 0 && data.displayName.length <= 120
    && ['member','admin'].includes(data.role as string);
}
export async function ensureSparkAccount(db: Firestore, user: Pick<User,'uid'|'email'|'displayName'>, desiredName?: string): Promise<void> {
  if (!user.email) throw new Error('accountProfile');
  const target = doc(db, 'users', user.uid);
  await runTransaction(db, async transaction => {
    const existing = await transaction.get(target);
    if (existing.exists()) {
      if (!validSparkProfile(existing.data(), user.uid)) throw new Error('accountProfile');
      return;
    }
    // Preserve the full email; only bound the optional display-name fallback.
    const fallback = (user.displayName?.trim() || user.email!).slice(0, 120).replace(/[\uD800-\uDBFF]$/u, '');
    const displayName = desiredName?.trim() || fallback;
    const profile: SparkProfile = { uid: user.uid, email: user.email!, displayName, role: 'member' };
    if (!validSparkProfile(profile, user.uid)) throw new Error('accountProfile');
    transaction.set(target, profile);
  });
}
export function canonicalSparkCategory(value: string): {name:string;id:string} {
  const name = value.trim().replace(/\s+/gu, ' ');
  if (!name || [...name].length > 60 || /[/\\\p{Cc}]/u.test(name) || name === '.' || name === '..') throw new Error('categoryInvalid');
  return {name, id:name.toLowerCase()};
}
export async function createSparkCategory(db: Firestore, uid: string, rawName: string): Promise<{id:string;name:string;created:boolean}> {
  const {name,id:key}=canonicalSparkCategory(rawName), freshId=crypto.randomUUID();
  try{return await runTransaction(db,async transaction=>{
    const registry=await transaction.get(doc(db,'categoryKeys',key));
    if(registry.exists()){
      const id=String(registry.get('categoryId')), [category,stat]=await Promise.all([transaction.get(doc(db,'categories',id)),transaction.get(doc(db,'categoryStats',id))]);
      if(!category.exists()||category.get('status')!=='active')throw new Error('categoryUnavailable');
      sparkStat(stat);return {id,name:String(category.get('name')),created:false};
    }
    const [canonical,receipt]=await Promise.all([transaction.get(doc(db,'categories',key)),transaction.get(doc(db,'sparkOperations','category-'+key))]);
    if(canonical.exists()&&canonicalSparkCategory(String(canonical.get('name'))).id===key)throw new Error('baselineRequired');
    if(receipt.exists()&&receipt.get('status')!=='done')throw new Error('categoryUnavailable');
    const id=canonical.exists()||receipt.exists()?freshId:key, target=doc(db,'categories',id);
    if(id!==key&&(await transaction.get(target)).exists())throw new Error('categoryExists');
    transaction.set(target,{name,status:'active',createdBy:uid,createdAt:serverTimestamp()});
    transaction.set(doc(db,'categoryKeys',key),{categoryId:id});transaction.set(doc(db,'categoryStats',id),emptySparkStat());
    return {id,name,created:true};
  });}catch(error){
    // A concurrent creator can commit the same name before this client receives
    // its response. Confirm the reserved name and active category from the server.
    try{
      const registry=await getDocFromServer(doc(db,'categoryKeys',key));
      if(registry.exists()){
        const id=String(registry.get('categoryId')),[category,stat]=await Promise.all([getDocFromServer(doc(db,'categories',id)),getDocFromServer(doc(db,'categoryStats',id))]);
        if(category.exists()&&category.get('status')==='active'&&canonicalSparkCategory(String(category.get('name'))).id===key){sparkStat(stat);return {id,name:String(category.get('name')),created:false};}
      }
    }catch{/* Preserve a failure that has no matching, verified category. */}
    throw error;
  }
}

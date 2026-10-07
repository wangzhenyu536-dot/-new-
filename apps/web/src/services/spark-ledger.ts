import { doc, serverTimestamp, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase/firestore';
export type SparkCategoryStat = { packCount:number; revision:number; packId:string; operationId:string; kind:string };
export function sparkStat(snapshot:DocumentSnapshot):SparkCategoryStat {
 const value=snapshot.data();
 if(!value||!Number.isSafeInteger(value.packCount)||value.packCount<0||!Number.isSafeInteger(value.revision)||value.revision<0)throw Object.assign(new Error('baselineRequired'),{code:'baselineRequired'});
 return value as SparkCategoryStat;
}
export function writeSparkCount(tx:Transaction,db:Firestore,id:string,previous:SparkCategoryStat,delta:number,packId:string,operationId:string,kind:'createPack'|'movePack'|'deletePack') {
 if(previous.packCount+delta<0)throw Object.assign(new Error('baselineRequired'),{code:'baselineRequired'});
 tx.set(doc(db,'categoryStats',id),{packCount:previous.packCount+delta,revision:previous.revision+1,packId,operationId,kind,updatedAt:serverTimestamp()});
}
export const emptySparkStat=()=>({packCount:0,revision:0,packId:'',operationId:'',kind:'init',updatedAt:serverTimestamp()});

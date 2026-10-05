import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { readFunctionsRegion, type RoleChangeInput, type RoleChangeResult } from '@evertrace/shared';
function failure(code:string){return new HttpsError('failed-precondition',code,{code});}
function parse(value:unknown):RoleChangeInput{
 const input=value as Partial<RoleChangeInput>;
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.uid)||typeof input.operationId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(input.operationId)||!['member','admin'].includes(input.role??'')||!['member','admin'].includes(input.expectedRole??''))throw new HttpsError('invalid-argument','Invalid role request.');
 return {uid:input.uid,role:input.role!,expectedRole:input.expectedRole!,operationId:input.operationId};
}
export const setMemberRole=onCall({region:readFunctionsRegion(process.env)},async request=>{
 if(!request.auth)throw new HttpsError('unauthenticated','Sign in.');
 const uid=request.auth.uid,auth=getAuth(),db=getFirestore();
 if((await auth.getUser(uid)).disabled||(await db.doc('users/'+uid).get()).get('role')!=='admin')throw new HttpsError('permission-denied','Administrator required.');
 const input=parse(request.data);let target;
 try{target=await auth.getUser(input.uid);}catch(error){if((error as {code?:string}).code==='auth/user-not-found')throw new HttpsError('not-found','Member not found.');throw error;}
 if(input.role==='admin'&&target.disabled)throw failure('memberUnavailable');
 return db.runTransaction(async tx=>{
  const actor=await tx.get(db.doc('users/'+uid));if(actor.get('role')!=='admin')throw new HttpsError('permission-denied','Administrator required.');
  const profile=await tx.get(db.doc('users/'+input.uid)),receipt=await tx.get(db.doc('roleOperations/'+input.operationId)),team=await tx.get(db.doc('system/team'));
  if(receipt.exists){const saved=receipt.data()!;if(saved.actorId!==uid||saved.uid!==input.uid||saved.role!==input.role||saved.expectedRole!==input.expectedRole)throw new HttpsError('already-exists','Request key already used.',{code:'requestChanged'});return saved.result as RoleChangeResult;}
  if(!profile.exists)throw new HttpsError('not-found','Member profile not found.');
  const previous=profile.get('role');if(!['member','admin'].includes(previous))throw failure('memberUnavailable');
  if(previous!==input.expectedRole)throw new HttpsError('aborted','Role changed.',{code:'roleChanged'});
  // Read actual roles to repair old count metadata. The shared team document serializes every role change and bootstrap.
  const administrators=await tx.get(db.collection('users').where('role','==','admin')),count=administrators.size,changed=previous!==input.role;
  if(changed&&previous==='admin'&&count<=1)throw failure('lastAdminRequired');
  const adminCount=count+(changed?(input.role==='admin'?1:-1):0);
  if(changed)tx.update(profile.ref,{role:input.role,updatedAt:FieldValue.serverTimestamp(),updatedBy:uid});
  tx.set(team.ref,{adminCount,schemaVersion:1,updatedAt:FieldValue.serverTimestamp()},{merge:true});
  const result:RoleChangeResult={uid:input.uid,role:input.role,changed,adminCount};
  tx.create(receipt.ref,{...input,actorId:uid,result,createdAt:FieldValue.serverTimestamp()});return result;
 });
});

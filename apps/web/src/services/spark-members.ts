import type { MemberRole, RoleChangeInput, RoleChangeResult } from '@evertrace/shared';
import { doc, getDocFromServer, runTransaction, type DocumentData, type Firestore } from 'firebase/firestore';

export class SparkMemberError extends Error {
  constructor(public code: string) { super(code); }
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value && value !== '.' && value !== '..' && !/[\\/]/.test(value) && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
function role(value: unknown): value is MemberRole { return value === 'member' || value === 'admin'; }
function exactFields(data: DocumentData, names: string[]) { return Object.keys(data).sort().join(',') === [...names].sort().join(','); }
function roleState(data: DocumentData | undefined): { adminCount: number; revision: number } {
  if (!data || !exactFields(data, ['adminCount', 'revision', 'changedUid', 'fromRole', 'toRole', 'operationId']) || !Number.isInteger(data.adminCount) || data.adminCount < 1 || !Number.isInteger(data.revision) || data.revision < 0 || typeof data.changedUid !== 'string' || typeof data.operationId !== 'string' || !role(data.fromRole) || !role(data.toRole)) throw new SparkMemberError('roleStateUnavailable');
  return { adminCount: data.adminCount, revision: data.revision };
}
function matchingReceipt(data: DocumentData, actorId: string, input: RoleChangeInput) {
  if (!exactFields(data, ['uid', 'actorId', 'fromRole', 'toRole', 'revision']) || data.uid !== input.uid || data.actorId !== actorId || data.fromRole !== input.expectedRole || data.toRole !== input.role || !Number.isInteger(data.revision) || data.revision < 1 || data.fromRole === data.toRole) throw new SparkMemberError('requestChanged');
}
function member(data: DocumentData | undefined, uid: string) {
  return Boolean(data && data.uid === uid && typeof data.email === 'string' && typeof data.displayName === 'string' && role(data.role));
}

export async function setSparkMemberRole(db: Firestore, actorId: string, input: RoleChangeInput): Promise<RoleChangeResult> {
  if (!identifier(actorId) || !input || !identifier(input.uid) || !identifier(input.operationId) || !role(input.role) || !role(input.expectedRole)) throw new SparkMemberError('invalid');
  const receiptRef = doc(db, 'roleOps', input.operationId), stateRef = doc(db, 'system', 'roles'), actorRef = doc(db, 'users', actorId), targetRef = doc(db, 'users', input.uid);
  try {
    return await runTransaction(db, async transaction => {
      // A committed self-demotion is still confirmable through its actor's receipt.
      const receipt = await transaction.get(receiptRef);
      if (receipt.exists()) {
        matchingReceipt(receipt.data(), actorId, input);
        const state = roleState((await transaction.get(stateRef)).data());
        return { uid: input.uid, role: input.role, changed: false, adminCount: state.adminCount };
      }
      if (input.role === input.expectedRole) throw new SparkMemberError('invalid');
      const [actor, target, savedState] = await Promise.all([transaction.get(actorRef), transaction.get(targetRef), transaction.get(stateRef)]);
      if (!member(actor.data(), actorId) || actor.get('role') !== 'admin') throw new SparkMemberError('forbidden');
      if (!member(target.data(), input.uid)) throw new SparkMemberError('memberUnavailable');
      if (target.get('role') !== input.expectedRole) throw new SparkMemberError('roleChanged');
      const state = roleState(savedState.data()), adminCount = state.adminCount + (input.role === 'admin' ? 1 : -1), revision = state.revision + 1;
      if (adminCount < 1) throw new SparkMemberError('lastAdminRequired');
      transaction.update(targetRef, { role: input.role });
      transaction.set(stateRef, { adminCount, revision, changedUid: input.uid, fromRole: input.expectedRole, toRole: input.role, operationId: input.operationId });
      transaction.set(receiptRef, { uid: input.uid, actorId, fromRole: input.expectedRole, toRole: input.role, revision });
      return { uid: input.uid, role: input.role, changed: true, adminCount };
    });
  } catch (error) {
    if (error instanceof SparkMemberError) throw error;
    // A lost acknowledgement must not make a successful write run a second time.
    try {
      const receipt = await getDocFromServer(receiptRef);
      if (receipt.exists()) {
        matchingReceipt(receipt.data(), actorId, input);
        const state = roleState((await getDocFromServer(stateRef)).data());
        return { uid: input.uid, role: input.role, changed: false, adminCount: state.adminCount };
      }
    } catch (confirmationError) {
      if (confirmationError instanceof SparkMemberError) throw confirmationError;
    }
    const code = (error as { code?: string }).code;
    throw new SparkMemberError(code === 'permission-denied' || code === 'unauthenticated' ? 'forbidden' : 'failed');
  }
}

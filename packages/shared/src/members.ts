import type { MemberRole } from './index.js';
export type RoleChangeInput = { uid: string; role: MemberRole; expectedRole: MemberRole; operationId: string };
export type RoleChangeResult = { uid: string; role: MemberRole; changed: boolean; adminCount: number };

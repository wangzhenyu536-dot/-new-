import type { Firestore } from 'firebase-admin/firestore';
export function initializeSparkSchema(db:Firestore):Promise<{categories:number;packs:number;createdStats:number;createdKeys:number}>;

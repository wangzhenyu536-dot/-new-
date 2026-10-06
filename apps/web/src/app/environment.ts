import { readFirebaseConfig } from '@evertrace/shared/firebase-config';
export const settings = readFirebaseConfig(import.meta.env);
export const isLocal = settings.local;

export const isSpark = settings.backend === 'spark';

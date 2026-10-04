import type { EegResult } from './validation.js';
export type UploadFile = { kind: 'text' | 'eeg'; name: string; size: number; sha256: string };
export type PlannedFile = UploadFile & { id: string; mediaType: string; stagingPath: string; storagePath: string };
export type BeginUploadInput = { requestId: string; title: string; categoryId: string; textContent: string; filePlan: UploadFile[] };
export type UploadSession = { sessionId: string; packId: string; files: PlannedFile[]; status?: string; result?: SaveResult };
export type SaveResult = { packId: string; cleanupPending: boolean };
export type StoredFile = { id: string; kind: 'text' | 'eeg'; originalName: string; storagePath: string; mediaType: string; size: number; sha256: string; generation: string; active: boolean; eegSummary?: EegResult['summary'] };
export const UPLOAD_POLICY = { lifetimeMs: 60 * 60 * 1000, leaseMs: 3 * 60 * 1000, mediaTypes: { text: 'text/plain', eeg: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } };

// Shared contracts only. Data operations are introduced with their iteration tests.
export type MemberRole = 'member' | 'admin';
export type PackStatus = 'ready' | 'deleting';
export type Language = 'en' | 'zh-CN';
export const EEG_TEMPLATE_VERSION = 'eeg-single-channel-v1';

export * from './validation.js';
export * from './firebase-config.js';
export * from './packs.js';

export * from './query.js';

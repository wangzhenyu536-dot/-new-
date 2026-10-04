import type { EegResult, Issue } from './validation.js';
export type FileKind = 'text' | 'eeg' | 'image';
export type UploadFile = { kind: FileKind; name: string; size: number; sha256: string };
export type PlannedFile = UploadFile & { id: string; mediaType: string; stagingPath: string; storagePath: string };
export type BeginUploadInput = { requestId: string; title: string; categoryId: string; textContent: string; filePlan: UploadFile[]; packId?: string; expectedVersion?: number; retainedFileIds?: string[] };
export type UploadSession = { sessionId: string; packId: string; files: PlannedFile[]; status?: string; result?: SaveResult };
export type SaveResult = { packId: string; cleanupPending: boolean };
export type StoredFile = { id: string; kind: FileKind; originalName: string; storagePath: string; mediaType: string; size: number; sha256: string; generation: string; active: boolean; eegSummary?: EegResult['summary']; imageSummary?: {width:number;height:number;format:string} };
// Provisional budgets, verified with synthetic data; real capacity is locked in R6–R9.
export const ATTACHMENT_LIMITS = { count:12, totalBytes:30*1024*1024, imageBytes:8*1024*1024, imagePixels:16*1000*1000 };
export const UPLOAD_POLICY = { lifetimeMs:60*60*1000, leaseMs:3*60*1000, mediaTypes:{text:'text/plain',eeg:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'} };
export function imageFormat(name:string):'png'|'jpeg'|'webp'|undefined {const ext=name.split('.').pop()?.toLowerCase();return ext==='png'||ext==='webp'?ext:ext==='jpg'||ext==='jpeg'?'jpeg':undefined;}
export function attachmentMediaType(kind:FileKind,name:string){return kind==='image'?'image/'+imageFormat(name):UPLOAD_POLICY.mediaTypes[kind];}
export function checkImageHeader(bytes:Uint8Array,name:string):Issue[]{
  const format=imageFormat(name),same=(offset:number,text:string)=>[...text].every((c,i)=>bytes[offset+i]===c.charCodeAt(0));
  const valid=format==='png'?bytes.length>=24&&bytes[0]===137&&same(1,'PNG\r\n\x1a\n')&&same(12,'IHDR'):format==='jpeg'?bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:format==='webp'?bytes.length>=20&&same(0,'RIFF')&&same(8,'WEBP'):false;
  if(!valid)return [{code:'imageType',file:name}];
  if(bytes.length>ATTACHMENT_LIMITS.imageBytes)return [{code:'imageSize',file:name}];
  return [];
}

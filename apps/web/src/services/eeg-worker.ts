import {PREVIEW_LIMITS,type EegResult} from '@evertrace/shared';
export function parseEegInWorker(bytes:Uint8Array,name:string,signal:AbortSignal):Promise<EegResult>{
 signal.throwIfAborted();return new Promise((resolve,reject)=>{const worker=new Worker(new URL('../workers/eeg.worker.ts',import.meta.url),{type:'module'}),timer=setTimeout(()=>finish(undefined,new Error('exportFailed')),PREVIEW_LIMITS.parseMs);
 function finish(result?:EegResult,error?:unknown){clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result!);}
 function abort(){finish(undefined,signal.reason??new Error('exportCancelled'));}signal.addEventListener('abort',abort,{once:true});worker.onmessage=(event:MessageEvent<EegResult>)=>finish(event.data);worker.onerror=()=>finish(undefined,new Error('exportFailed'));const copy=bytes.slice();worker.postMessage({bytes:copy,name},[copy.buffer]);
 });
}

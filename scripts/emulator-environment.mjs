import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
export function emulatorTempDir(root, mode) { return path.join(root, '.runtime', 'emulators', mode === 'start' ? 'preview-tmp' : 'test-tmp'); }
export function latestPreviewExport(root) {
  const exports=[];
  for(const name of ['emulator-data','preview-backup']){
    const folder=path.join(root,'.runtime',name),file=path.join(folder,'firebase-export-metadata.json');
    try{const data=JSON.parse(readFileSync(file,'utf8'));if(typeof data.version==='string'&&['auth','firestore','storage'].some(key=>typeof data[key]?.path==='string'))exports.push({folder,time:statSync(file).mtimeMs});}catch{/* Missing or malformed exports are not import candidates. */}
  }
  return exports.sort((a,b)=>b.time-a.time)[0]?.folder;
}

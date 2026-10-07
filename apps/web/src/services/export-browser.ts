import {getDocFromServer,doc} from 'firebase/firestore';
import {getBytes,ref} from 'firebase/storage';
import {db,storage} from '../app/legacy-firebase';
import {type ExportDependencies,type ExportPack} from './export-pack';
import {parseEegInWorker} from './eeg-worker';
import {digestBytes,renderFullPng,zipInWorker} from './export-render';
export {digestBytes,renderFullPng,deliverDownload} from './export-render';
export function browserExportDependencies(pack:ExportPack):ExportDependencies{return {readVersion:async()=>{const saved=await getDocFromServer(doc(db,'packs',pack.id));return saved.exists()?{version:saved.get('version'),status:saved.get('status')}:null;},readFile:async file=>new Uint8Array(await getBytes(ref(storage,file.storagePath),file.size)),digest:digestBytes,parseEeg:parseEegInWorker,renderPng:renderFullPng,zip:zipInWorker};}

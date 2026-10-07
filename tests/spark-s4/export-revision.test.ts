import { expect,it } from 'vitest';
import { assertExportVersion, type ExportPack } from '../../apps/web/src/services/export-pack';
const pack={id:'synthetic',title:'synthetic',category:'source',ownerId:'member',ownerName:'member',textContent:'notes',createdAt:'2026-10-06',version:1,status:'ready',revision:'1:0'} as ExportPack & {revision:string};
it('category metadata moving during export is detected even while original file version is unchanged',async()=>{await expect(assertExportVersion(pack,async()=>({version:1,status:'ready',revision:'2:0'}),new AbortController().signal)).rejects.toThrow('exportChanged');});
it('same metadata revision permits an exact original export',async()=>{await expect(assertExportVersion(pack,async()=>({version:1,status:'ready',revision:'1:0'}),new AbortController().signal)).resolves.toBeUndefined();});
it('legacy exports without a metadata revision keep their existing version checks',async()=>{const {revision:ignored,...legacy}=pack;expect(ignored).toBe('1:0');await expect(assertExportVersion(legacy,async()=>({version:1,status:'ready'}),new AbortController().signal)).resolves.toBeUndefined();});

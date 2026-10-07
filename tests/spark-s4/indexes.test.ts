import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const config=JSON.parse(readFileSync(new URL('../../firebase/spark.indexes.json',import.meta.url),'utf8'));
it.each([false,true])('declares the pending operations index for owner-filter=$0',owner=>{
 const fields=[{fieldPath:'status',order:'ASCENDING'},...(owner?[{fieldPath:'ownerId',order:'ASCENDING'},{fieldPath:'kind',order:'ASCENDING'}]:[]),{fieldPath:'updatedAt',order:'DESCENDING'},{fieldPath:'__name__',order:'DESCENDING'}];
 expect(config.indexes).toContainEqual({collectionGroup:'sparkOperations',queryScope:'COLLECTION',fields});
});
it('retains all eight pack list combinations and keeps original byte payloads exempt',()=>{
 expect(config.indexes.filter((value:{collectionGroup:string})=>value.collectionGroup==='packs')).toHaveLength(8);
 expect(config.fieldOverrides).toContainEqual({collectionGroup:'files',fieldPath:'bytes',indexes:[]});
});

import writeExcel from 'write-excel-file/node';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
export const validRows = [['timestamp_ms', 'value'], [0, -3], [2.5, 0], [7, 4]];
export async function workbook(rows = validRows, multiple = false) {
  return new Uint8Array(await (multiple ? writeExcel([{ data: rows, sheet: 'EEG' }, { data: rows, sheet: 'Other' }]) : writeExcel(rows, { sheet: 'EEG' })).toBuffer());
}
export function mutateWorkbook(bytes, edit) {
  const files = unzipSync(bytes); edit(files); return zipSync(files);
}
export function editSheet(bytes, edit) { return mutateWorkbook(bytes, files => { const path = Object.keys(files).find(x => /^xl\/worksheets\/sheet\d+\.xml$/.test(x)); files[path] = strToU8(edit(strFromU8(files[path]))); }); }

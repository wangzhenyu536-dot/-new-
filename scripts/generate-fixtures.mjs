import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { workbook, editSheet, validRows } from '../tests/fixtures/workbooks.mjs';
const root = 'outputs/R2/samples'; mkdirSync(root, { recursive: true });
const valid = await workbook();
writeFileSync(`${root}/synthetic-eeg-valid.xlsx`, valid);
writeFileSync(`${root}/synthetic-eeg-empty-value.xlsx`, await workbook([validRows[0], [0, 1], [2, null], [4, 3]]));
writeFileSync(`${root}/synthetic-eeg-duplicate-time.xlsx`, await workbook([validRows[0], [0, 1], [0, 2]]));
writeFileSync(`${root}/synthetic-eeg-formula.xlsx`, editSheet(valid, xml => xml.replace(/(<c\b[^>]*\br="B2"[^>]*>)[\s\S]*?<\/c>/, '$1<f>1+2</f><v>3</v></c>')));
writeFileSync(`${root}/synthetic-notes.txt`, 'Synthetic practice notes. These are not real EEG measurements.\n');
writeFileSync(`${root}/README.txt`, 'All files are synthetic test fixtures, not real device measurements.\nThe proposed template has timestamp_ms and value columns, with milliseconds and raw values only.\n');
console.log('Synthetic R2 samples generated at ' + root);

// Small generated colour patches are fixtures, not photographs or real EEG data.
for(const format of ['png','jpeg','webp'])writeFileSync(`apps/web/public/samples/synthetic-image.${format}`,await sharp({create:{width:240,height:160,channels:3,background:'#879992'}}).toFormat(format).toBuffer());

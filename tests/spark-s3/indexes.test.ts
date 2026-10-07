import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const config = JSON.parse(readFileSync(new URL('../../firebase/spark.indexes.json', import.meta.url), 'utf8'));
const combinations = [false, true].flatMap(prefix => [false, true].flatMap(category => [false, true].map(mine => ({ prefix, category, mine }))));
it.each(combinations)('declares the stable Spark list index for prefix=$prefix, category=$category, mine=$mine', ({ prefix, category, mine }) => {
  const fields = [{ fieldPath: 'status', order: 'ASCENDING' },
    ...(category ? [{ fieldPath: 'categoryId', order: 'ASCENDING' }] : []),
    ...(mine ? [{ fieldPath: 'ownerId', order: 'ASCENDING' }] : []),
    { fieldPath: prefix ? 'titleSearch' : 'createdAt', order: prefix ? 'ASCENDING' : 'DESCENDING' },
    { fieldPath: '__name__', order: prefix ? 'ASCENDING' : 'DESCENDING' }];
  expect(config.indexes).toContainEqual({ collectionGroup: 'packs', queryScope: 'COLLECTION', fields });
});
it('preserves original Bytes index exemption and never adds a composite index over the payload', () => {
  expect(config.fieldOverrides).toContainEqual({ collectionGroup: 'files', fieldPath: 'bytes', indexes: [] });
  expect(config.indexes.some((index: {fields: {fieldPath: string}[]}) => index.fields.some(field => field.fieldPath === 'bytes'))).toBe(false);
});

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('exempts the large original Bytes field from every automatic index', () => {
  const config = JSON.parse(readFileSync(new URL('../../firebase/spark.indexes.json', import.meta.url), 'utf8'));
  expect(config.fieldOverrides).toContainEqual({ collectionGroup: 'files', fieldPath: 'bytes', indexes: [] });
  expect(config.indexes.some((index: {fields: {fieldPath: string}[]}) => index.fields.some(field => field.fieldPath === 'bytes'))).toBe(false);
});
it('uses the same official rules and index configuration for both isolated Spark environments', () => {
  for (const filename of ['firebase.spark-preview.json', 'firebase.spark-s1-test.json']) {
    const config = JSON.parse(readFileSync(new URL(`../../${filename}`, import.meta.url), 'utf8'));
    expect(config.firestore).toEqual({ rules: 'firebase/spark.rules', indexes: 'firebase/spark.indexes.json' });
  }
});
it('declares the ready list composite index including its stable document-ID direction', () => {
  const config = JSON.parse(readFileSync(new URL('../../firebase/spark.indexes.json', import.meta.url), 'utf8'));
  expect(config.indexes).toContainEqual({ collectionGroup: 'packs', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'createdAt', order: 'DESCENDING' },
    { fieldPath: '__name__', order: 'DESCENDING' },
  ] });
});

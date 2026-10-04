import { expect, test } from 'vitest';
import { emulatorTempDir, latestPreviewExport } from '../../scripts/emulator-environment.mjs';
test('test and preview Storage emulators never share their OS temporary blob directory', () => {
  const root='/project';
  expect(emulatorTempDir(root,'start')).toBe('/project/.runtime/p');
  expect(emulatorTempDir(root,'exec')).toBe('/project/.runtime/t');
  expect(emulatorTempDir(root,'e2e')).toBe(emulatorTempDir(root,'exec'));
  expect(emulatorTempDir(root,'start')).not.toBe(emulatorTempDir(root,'exec'));
});

test('restart uses the newest valid local export, preserving a newer full preview snapshot', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const path = await import('node:path');
  const root=mkdtempSync(path.join(tmpdir(),'evertrace-export-test-'));
  try {
    expect(latestPreviewExport(root)).toBeUndefined();
    for(const [name,time] of [['emulator-data',1000],['preview-backup',2000]] as const){const folder=path.join(root,'.runtime',name);mkdirSync(folder,{recursive:true});const file=path.join(folder,'firebase-export-metadata.json');writeFileSync(file,JSON.stringify({version:'15',firestore:{path:'firestore_export'}}));utimesSync(file,time,time);}
    expect(latestPreviewExport(root)).toBe(path.join(root,'.runtime','preview-backup'));
    const saved=path.join(root,'.runtime','emulator-data','firebase-export-metadata.json');utimesSync(saved,3000,3000);
    expect(latestPreviewExport(root)).toBe(path.dirname(saved));
    writeFileSync(saved,'invalid JSON');
    expect(latestPreviewExport(root)).toBe(path.join(root,'.runtime','preview-backup'));
  } finally { rmSync(root,{recursive:true,force:true}); }
});

// Darwin limits Unix socket paths to 104 bytes including the terminator.
test('emulator temp paths leave space for Firebase function sockets on this checkout',()=>{
  const root='/Users/programmer_mu/SelfProject/BrainWave/-new-';
  for(const mode of ['start','exec'])expect(Buffer.byteLength(emulatorTempDir(root,mode)+'/fire_emu_1234567890123456.sock')).toBeLessThan(104);
});

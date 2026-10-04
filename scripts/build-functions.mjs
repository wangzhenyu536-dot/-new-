import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ entryPoints: [root + 'functions/src/index.ts', root + 'functions/src/maintenance.ts'], outdir: root + 'functions/lib', bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: true, metafile: true, external: ['firebase-admin/*', 'firebase-functions/*', 'sharp'] });
if (Object.values(result.metafile.outputs).some(output => output.imports.some(item => item.external && item.path.startsWith('@evertrace/')))) throw new Error('A workspace dependency escaped the deployable function bundle.');
writeFileSync(root + 'functions/lib/build-meta.json', JSON.stringify(result.metafile));

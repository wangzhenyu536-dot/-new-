import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (!existsSync('outputs/R0/baseline/geometry.json')) {
  const result = spawnSync(process.execPath, ['scripts/capture-baseline.mjs'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}

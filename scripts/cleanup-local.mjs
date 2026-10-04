import { spawnSync } from 'node:child_process';
const result=spawnSync(process.execPath,['scripts/cleanup-uploads.mjs'],{stdio:'inherit',env:{...process.env,GCLOUD_PROJECT:'demo-evertrace',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9199',METADATA_SERVER_DETECTION:'none'}});
process.exitCode=result.status??1;

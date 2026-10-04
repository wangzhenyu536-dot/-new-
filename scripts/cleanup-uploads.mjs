import { initializeApp } from 'firebase-admin/app';
const projectId=process.env.GCLOUD_PROJECT;
if(projectId!=='demo-evertrace'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_STORAGE_EMULATOR_HOST!=='127.0.0.1:9199')throw new Error('Local maintenance requires explicit default demo emulator endpoints.');
initializeApp({projectId,storageBucket:process.env.EVERTRACE_STORAGE_BUCKET||projectId+'.appspot.com'});
const {cleanExpiredUploads}=await import('../functions/lib/maintenance.js');
process.stdout.write(JSON.stringify(await cleanExpiredUploads())+'\n');

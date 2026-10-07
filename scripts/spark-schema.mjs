import { initializeApp,deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeSparkSchema } from './initialize-spark-schema.mjs';
const [projectId,...extra]=process.argv.slice(2);
const allowed=projectId==='demo-evertrace-spark'?'127.0.0.1:28190':projectId==='demo-evertrace-spark-test'?'127.0.0.1:28090':null;
if(!allowed||extra.length||process.env.FIRESTORE_EMULATOR_HOST!==allowed)throw Error('Only the explicitly isolated local Spark preview or test database may be prepared. Cloud preparation is not enabled in S4.');
process.env.METADATA_SERVER_DETECTION='none';
const app=initializeApp({projectId});try{console.log(JSON.stringify(await initializeSparkSchema(getFirestore(app))));}finally{await deleteApp(app);}

import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),mode=process.argv[2]||'verify';
if(!['rules','e2e','verify','red','start','transitions','s2-rules','s2-e2e','s2','s3-rules','s3-e2e','s3','s4-rules','s4-e2e','s4-regression','s4'].includes(mode))throw new Error('Use rules, e2e, verify, red or start.');
const stage=mode.startsWith('s4')?'S4':mode.startsWith('s3')?'S3':mode.startsWith('s2')?'S2':'S1';
const preview=mode==='start',project=preview?'demo-evertrace-spark':'demo-evertrace-spark-test';
const temporary=path.join(root,preview?'.runtime/sp':'.runtime/st'),working=path.join(root,preview?'.runtime/spark-preview-run':'.runtime/spark-test-run');
for(const directory of [temporary,working,path.join(root,'outputs',stage)])mkdirSync(directory,{recursive:true});
const env={...process.env,PATH:path.join(root,'node_modules/.bin')+path.delimiter+(process.env.PATH||''),TMPDIR:temporary,TMP:temporary,TEMP:temporary,METADATA_SERVER_DETECTION:'none',FIREBASE_EMULATORS_PATH:path.join(root,'.cache/firebase')};
for(const key of Object.keys(env))if(key.endsWith('_EMULATOR_HOST'))delete env[key];
env.SPARK_STAGE=stage;
env.SPARK_S1_BOOTSTRAP_RED=mode==='red'?'1':'0';
const java=path.join(root,'.runtime/java');if(existsSync(path.join(java,'bin/java'))){env.JAVA_HOME=java;env.PATH=path.join(java,'bin')+path.delimiter+env.PATH;}
const quote=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
const config=path.join(root,preview?'firebase.spark-preview.json':'firebase.spark-s1-test.json');
const command=[process.execPath,path.join(root,'scripts/spark-check.mjs'),mode].map(quote).join(' ');
const args=preview?['emulators:start','--config',config,'--project',project,'--only','auth,firestore']:['emulators:exec','--config',config,'--project',project,'--only','auth,firestore',command];
if(preview){const saved=path.join(root,'.runtime/spark-preview-data');if(existsSync(path.join(saved,'firebase-export-metadata.json')))args.push('--import',saved);args.push('--export-on-exit',saved);}
writeFileSync(path.join(root,'outputs',stage,preview?'preview-isolation.json':'test-isolation.json'),JSON.stringify({project,temporary,working,services:['auth','firestore'],mode,cloudDeployed:false},null,2));
const child=spawn(path.join(root,'node_modules/.bin/firebase'),args,{cwd:working,env,stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));

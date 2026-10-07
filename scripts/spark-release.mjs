import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {sparkCloudSettings,sparkDeployArgs} from './spark-release-config.mjs';
function run(command,args,options={}){const result=spawnSync(command,args,{stdio:'inherit',...options});if(result.error)throw result.error;if(result.status!==0)throw Error(`Release step failed (${result.status}). Nothing further was deployed.`);}
try{
 const [mode,projectId,...extra]=process.argv.slice(2);
 if(!['prepare','deploy'].includes(mode)||extra.length)throw Error('Use npm run cloud:spark:prepare -- PROJECT_ID or cloud:spark:deploy -- PROJECT_ID.');
 if(Object.entries(process.env).some(([key,value])=>key.endsWith('_EMULATOR_HOST')&&value))throw Error('Use a terminal without emulator environment variables for cloud release.');
 if(!existsSync('.env.spark.local'))throw Error('Create .env.spark.local from spark.env.example.');
 const settings=sparkCloudSettings(readFileSync('.env.spark.local','utf8'),projectId);
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('VITE_')));
 run('npm',['run','build:shared']);run(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'--noEmit','-p','apps/web/tsconfig.json']);
 run(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'build','--mode','spark-cloud','--manifest','--outDir','dist-spark'],{cwd:resolve('apps/web'),env:{...env,...settings.env,NODE_ENV:'production'}});
 const audit=JSON.parse(readFileSync('apps/web/dist-spark/spark-build-audit.json','utf8'));
 if(audit.backend!=='spark'||audit.emulators!==false||audit.forbiddenModules.length)throw Error('Spark production dependency audit failed.');
 mkdirSync('outputs/S5',{recursive:true});const manifest={projectId,preparedAt:new Date().toISOString(),backend:'spark',services:['auth','firestore','hosting'],deployed:false,audit,deploymentArgs:sparkDeployArgs(projectId)};writeFileSync('outputs/S5/release-manifest.json',JSON.stringify(manifest,null,2)+'\n');
 console.log(`Spark release prepared for ${projectId}. No cloud resources or billing were changed.`);
 if(mode==='deploy'){
  run(resolve('node_modules/.bin/firebase'),sparkDeployArgs(projectId));
  writeFileSync('outputs/S5/release-manifest.json',JSON.stringify({...manifest,deployed:true,deployedAt:new Date().toISOString()},null,2)+'\n');
  console.log(`Hosting URL: https://${projectId}.web.app — verify signup, email, permissions and original files before accepting the cloud release.`);
 }
}catch(error){console.error(error.message);process.exitCode=1;}

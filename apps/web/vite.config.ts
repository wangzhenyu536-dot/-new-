import {defineConfig,loadEnv,type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {sparkCloudSettings} from '../../scripts/spark-release-config.mjs';
const envDir=fileURLToPath(new URL('../../',import.meta.url));
export default defineConfig(({mode})=>{
 const cloud=mode==='spark-cloud',dedicated=cloud||mode==='spark-test';
 const selected={...loadEnv(mode,envDir),...process.env};
 if(mode==='spark-test'&&(selected.VITE_DATA_BACKEND!=='spark'||selected.VITE_USE_EMULATORS!=='true'||selected.VITE_FIREBASE_PROJECT_ID!=='demo-evertrace-spark-test'||selected.VITE_AUTH_EMULATOR_PORT!=='29099'||selected.VITE_FIRESTORE_EMULATOR_PORT!=='28090'))throw Error('The built regression entry requires the isolated Spark test project and ports.');
 if(cloud){const env=selected;sparkCloudSettings(Object.entries(env).filter(([key])=>key.startsWith('VITE_')).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n'),env.VITE_FIREBASE_PROJECT_ID??'');}
 const isolation:Plugin={
  name:'spark-production-isolation',enforce:'pre',
  resolveId(source,importer){if(!dedicated)return;if(source==='./app/App'&&importer?.endsWith('/src/main.tsx'))return resolve(envDir,'apps/web/src/app/SparkApp.tsx');if(source==='./account-services'&&importer?.endsWith('/app/AuthProvider.tsx'))return resolve(envDir,'apps/web/src/app/account-services.spark.ts');},
  transform(_code,id){if(dedicated&&id.split('?')[0].endsWith('/apps/web/src/app/environment.ts'))return `import {readFirebaseConfig} from '@evertrace/shared/firebase-config';export const settings=readFirebaseConfig(import.meta.env);export const isLocal=${!cloud};export const isSpark=true;`;},
  generateBundle(_options,bundle){if(!dedicated)return;const modules=[...new Set(Object.values(bundle).filter(item=>item.type==='chunk').flatMap(item=>Object.keys(item.modules)))].sort();const forbiddenModules=modules.filter(id=>/@firebase\/(storage|functions)\b|\/firebase\/(storage|functions)\b|legacy-firebase|\/pages\/(CreatePackPage|PacksPage|PackDetailPage|CategoriesPage|MembersPage)\.tsx/.test(id));if(forbiddenModules.length)throw Error('Spark release contains legacy paid-service modules: '+forbiddenModules.join(', '));this.emitFile({type:'asset',fileName:'spark-build-audit.json',source:JSON.stringify({mode,backend:'spark',emulators:!cloud,modules,forbiddenModules},null,2)});}
 };
 return {plugins:[react(),isolation],envDir};
});

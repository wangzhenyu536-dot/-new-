import {parseEnv} from 'node:util';
const fields=['VITE_DATA_BACKEND','VITE_USE_EMULATORS','VITE_FIREBASE_PROJECT_ID','VITE_FIREBASE_API_KEY','VITE_FIREBASE_AUTH_DOMAIN','VITE_FIREBASE_APP_ID'];
function project(id){if(typeof id!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id)||id.startsWith('demo-'))throw Error('An explicit real Firebase project ID is required.');}
export function sparkCloudSettings(text,expectedProject){
 const input=parseEnv(text);project(expectedProject);
 if(input.VITE_DATA_BACKEND!=='spark'||input.VITE_USE_EMULATORS!=='false')throw Error('Spark release requires VITE_DATA_BACKEND=spark and VITE_USE_EMULATORS=false.');
 const env=Object.fromEntries(fields.map(key=>[key,input[key]]));
 if(fields.some(key=>typeof env[key]!=='string'||!env[key].trim()))throw Error('Complete the six public Spark Web settings before preparing the release.');
 if(env.VITE_FIREBASE_PROJECT_ID!==expectedProject)throw Error('The explicit project ID must match .env.spark.local.');
 const domain=env.VITE_FIREBASE_AUTH_DOMAIN;
 if(!domain||!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain)||['localhost','127.0.0.1'].includes(domain)||domain.includes('..'))throw Error('Copy the production Auth domain without a URL scheme or path.');
 return {projectId:expectedProject,env};
}
export function sparkDeployArgs(projectId){project(projectId);return ['deploy','--project',projectId,'--config','firebase.spark.cloud.json','--only','firestore:rules,firestore:indexes,hosting'];}

import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {bootstrapSparkAdmin} from './bootstrap-spark-admin.mjs';
const projectId='demo-evertrace-spark';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:28190'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:29199')throw new Error('Only the isolated Spark preview is allowed.');
const app=initializeApp({projectId}),auth=getAuth(app),db=getFirestore(app);
try {
 for(const role of ['member','admin']){
  const email=`${role}@spark.evertrace.test`;let user;
  try{user=await auth.getUserByEmail(email);}catch(error){if(error.code!=='auth/user-not-found')throw error;user=await auth.createUser({email,password:'EvertraceDemo2026!'});}
  const target=db.doc(`users/${user.uid}`);
  await db.runTransaction(async tx=>{if(!(await tx.get(target)).exists)tx.create(target,{uid:user.uid,email,displayName:role==='admin'?'Spark Administrator':'Spark Member',role:'member'});});
  if(role==='admin')await bootstrapSparkAdmin(db,user.uid);
  console.log({email,uid:user.uid,role:(await target.get()).get('role')});
 }
} finally{await deleteApp(app);}

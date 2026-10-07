import type {User} from 'firebase/auth';
import {auth,db} from './firebase';
import {ensureSparkAccount} from '../services/spark-account';
export {createUserWithEmailAndPassword,onAuthStateChanged,signInWithEmailAndPassword,signOut} from 'firebase/auth';
export {doc,onSnapshot} from 'firebase/firestore';
export {auth,db};
export async function ensureAccount(user:User,displayName?:string):Promise<void>{await ensureSparkAccount(db,user,displayName);}

import {createContext} from 'react';
import type {User} from 'firebase/auth';
export type Profile = {uid:string;email:string;displayName:string;role:'member'|'admin'};
export type AuthState = {user:User|null;profile:Profile|null;status:'loading'|'ready'|'error'};
export type AuthAccess = AuthState & {register:(email:string,password:string,name:string)=>Promise<void>;login:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>;retry:()=>void};
// Keep the context identity separate from refreshed providers and lazy consumers.
export const AuthContext = createContext<AuthAccess|null>(null);

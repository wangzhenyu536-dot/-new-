import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from './firebase';
export type Profile = { uid: string; email: string; displayName: string; role: 'member' | 'admin' };
type State = { user: User | null; profile: Profile | null; status: 'loading' | 'ready' | 'error' };
type Access = State & { register: (email: string, password: string, name: string) => Promise<void>; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; retry: () => void };
const Context = createContext<Access | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ user: null, profile: null, status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const desiredName = useRef<string | undefined>(undefined);
  useEffect(() => {
    let generation = 0, active = true, stopProfile: (() => void) | undefined;
    const stopAuth = onAuthStateChanged(auth, user => {
      const ticket = ++generation; stopProfile?.(); stopProfile = undefined;
      if (!user) { setState({ user: null, profile: null, status: 'ready' }); return; }
      setState({ user, profile: null, status: 'loading' });
      const name = desiredName.current;
      void httpsCallable(functions, 'ensureProfile')(name === undefined ? {} : { displayName: name }).then(() => {
        if (!active || ticket !== generation) return;
        desiredName.current = undefined;
        stopProfile = onSnapshot(doc(db, 'users', user.uid), snapshot => {
          const profile = snapshot.data() as Profile | undefined;
          if (profile?.uid !== user.uid || !['member', 'admin'].includes(profile.role)) { setState({ user, profile: null, status: 'error' }); return; }
          setState({ user, profile, status: 'ready' });
        }, () => { if (active && ticket === generation) setState({ user, profile: null, status: 'error' }); });
      }).catch(() => { if (active && ticket === generation) setState({ user, profile: null, status: 'error' }); });
    }, () => setState({ user: null, profile: null, status: 'error' }));
    return () => { active = false; generation++; stopAuth(); stopProfile?.(); };
  }, [attempt]);
  const register = useCallback(async (email: string, password: string, name: string) => {
    desiredName.current = name;
    try { await createUserWithEmailAndPassword(auth, email, password); }
    catch (error) { desiredName.current = undefined; throw error; }
  }, []);
  const login = useCallback(async (email: string, password: string) => { await signInWithEmailAndPassword(auth, email, password); }, []);
  const logout = useCallback(async () => { await signOut(auth); desiredName.current = undefined; }, []);
  return <Context.Provider value={{ ...state, register, login, logout, retry: () => setAttempt(n => n + 1) }}>{children}</Context.Provider>;
}
export function useAuth() { const context = useContext(Context); if (!context) throw new Error('AuthProvider is required.'); return context; }

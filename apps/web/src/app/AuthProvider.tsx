import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AuthContext, type AuthState, type Profile } from './auth-context';
export type { Profile } from './auth-context';
let loadedServices: typeof import('./account-services') | undefined;
const services = () => import('./account-services').then(value => { loadedServices = value; return value; });
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, profile: null, status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const desiredName = useRef<string | undefined>(undefined);
  useEffect(() => {
    let generation = 0, active = true, stopProfile: (() => void) | undefined;
    let stopAuth: (() => void) | undefined;
    void services().then(({ onAuthStateChanged, auth, ensureAccount, onSnapshot, doc, db }) => {
      if (!active) return;
      stopAuth = onAuthStateChanged(auth, user => {
      const ticket = ++generation; stopProfile?.(); stopProfile = undefined;
      if (!user) { setState({ user: null, profile: null, status: 'ready' }); return; }
      setState({ user, profile: null, status: 'loading' });
      const name = desiredName.current;
      void ensureAccount(user, name).then(() => {
        if (!active || ticket !== generation) return;
        desiredName.current = undefined;
        stopProfile = onSnapshot(doc(db, 'users', user.uid), snapshot => {
          if (!active || ticket !== generation) return;
          const profile = snapshot.data() as Profile | undefined;
          if (profile?.uid !== user.uid || !['member', 'admin'].includes(profile.role)) { setState({ user, profile: null, status: 'error' }); return; }
          setState({ user, profile, status: 'ready' });
        }, () => { if (active && ticket === generation) setState({ user, profile: null, status: 'error' }); });
      }).catch(() => { if (active && ticket === generation) setState({ user, profile: null, status: 'error' }); });
    }, () => setState({ user: null, profile: null, status: 'error' }));
    }).catch(() => { if (active) setState({ user: null, profile: null, status: 'error' }); });
    return () => { active = false; generation++; stopAuth?.(); stopProfile?.(); };
  }, [attempt]);
  const register = useCallback(async (email: string, password: string, name: string) => {
    const { auth, createUserWithEmailAndPassword } = loadedServices ?? await services();
    desiredName.current = name;
    try { await createUserWithEmailAndPassword(auth, email, password); }
    catch (error) { desiredName.current = undefined; throw error; }
  }, []);
  const login = useCallback(async (email: string, password: string) => { const { auth, signInWithEmailAndPassword } = loadedServices ?? await services(); await signInWithEmailAndPassword(auth, email, password); }, []);
  const logout = useCallback(async () => { const { auth, signOut } = loadedServices ?? await services(); await signOut(auth); desiredName.current = undefined; }, []);
  return <AuthContext.Provider value={{ ...state, register, login, logout, retry: () => setAttempt(n => n + 1) }}>{children}</AuthContext.Provider>;
}

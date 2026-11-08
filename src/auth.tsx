import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage } from './api';
import type { SessionInfo } from './types';

interface AuthContextValue {
  session: SessionInfo | null;
  loading: boolean;
  signIn: (credentials: { username: string; password: string; gateway: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const next = await api.session();
      setSession(next.authenticated ? next : null);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setSession(null);
    window.addEventListener('xu:unauthorized', onUnauthorized);
    return () => window.removeEventListener('xu:unauthorized', onUnauthorized);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      signIn: async (credentials) => {
        try {
          const next = await api.login(credentials);
          setSession(next);
        } catch (error) {
          throw new Error(errorMessage(error));
        }
      },
      signOut: async () => {
        try {
          await api.logout();
        } finally {
          setSession(null);
        }
      },
      refresh,
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, AuthError, type Me } from '../api/client.js';

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const m = await api.me();
      setMe(m);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    setMe(null);
  }

  useEffect(() => {
    refresh();
  }, []);

  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth used outside AuthProvider');
  return v;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !me) {
      navigate('/login', { replace: true, state: { from: location.pathname } });
    }
  }, [loading, me, navigate, location.pathname]);

  if (loading) return <div className="p-6 text-neutral-400">Loading…</div>;
  if (!me) return null;
  return <>{children}</>;
}

/** Global handler: when any request throws AuthError, bounce to /login. */
export function useAuthErrorBoundary() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    function onUnhandled(e: PromiseRejectionEvent) {
      if (e.reason instanceof AuthError) {
        e.preventDefault();
        navigate('/login', { replace: true, state: { from: location.pathname } });
      }
    }
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => window.removeEventListener('unhandledrejection', onUnhandled);
  }, [navigate, location.pathname]);
}

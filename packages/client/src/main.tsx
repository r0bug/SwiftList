import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { ItemsPage } from './routes/ItemsPage.js';
import { ItemDetailPage } from './routes/ItemDetailPage.js';
import { LoginPage } from './routes/LoginPage.js';
import { PoolPage } from './routes/PoolPage.js';
import { DraftsPage } from './routes/DraftsPage.js';
import { DevicesPage } from './routes/DevicesPage.js';
import { SettingsPage } from './routes/SettingsPage.js';
import { AuthProvider, RequireAuth, useAuth, useAuthErrorBoundary } from './hooks/useAuth.js';

const queryClient = new QueryClient();

function Layout({ children }: { children: React.ReactNode }) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  useAuthErrorBoundary();
  return (
    <div className="min-h-screen flex">
      <nav className="w-56 border-r border-neutral-800 p-4 flex flex-col">
        <h1 className="text-xl font-semibold mb-6">swiftlist</h1>
        <div className="space-y-1 flex-1">
          <NavItem to="/">Items</NavItem>
          <NavItem to="/pool">Pool</NavItem>
          <NavItem to="/drafts">Drafts</NavItem>
          <NavItem to="/devices">Devices</NavItem>
          <NavItem to="/settings">Settings</NavItem>
        </div>
        <div className="text-xs text-neutral-500 mt-6 space-y-2">
          {me && (
            <>
              <div>{me.email}</div>
              <button
                onClick={async () => {
                  await logout();
                  navigate('/login', { replace: true });
                }}
                className="text-neutral-400 hover:text-neutral-200 underline"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </nav>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `block px-3 py-2 rounded ${isActive ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`
      }
    >
      {children}
    </NavLink>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="*"
              element={
                <RequireAuth>
                  <Layout>
                    <Routes>
                      <Route path="/" element={<ItemsPage />} />
                      <Route path="/items/:id" element={<ItemDetailPage />} />
                      <Route path="/pool" element={<PoolPage />} />
                      <Route path="/drafts" element={<DraftsPage />} />
                      <Route path="/devices" element={<DevicesPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                    </Routes>
                  </Layout>
                </RequireAuth>
              }
            />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

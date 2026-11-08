import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Router } from 'lucide-react';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { Spinner, ToastProvider } from './components/ui';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { DevicesPage } from './pages/Devices';
import { WifiPage } from './pages/Wifi';
import { PortForwardingPage } from './pages/PortForwarding';
import { FirewallPage } from './pages/Firewall';
import { ParentalPage } from './pages/Parental';
import { AdvancedPage } from './pages/Advanced';
import { DiagnosticsPage } from './pages/Diagnostics';
import { LogsPage } from './pages/Logs';
import { SystemPage } from './pages/System';

function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-mark">
        <Router size={30} />
      </div>
      <Spinner size={22} />
      <p>Opening the local dashboard…</p>
    </div>
  );
}

function ProtectedLayout() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <BootScreen />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Layout />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedLayout />}>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/devices" element={<DevicesPage />} />
              <Route path="/wifi" element={<WifiPage />} />
              <Route path="/port-forwarding" element={<PortForwardingPage />} />
              <Route path="/firewall" element={<FirewallPage />} />
              <Route path="/parental" element={<ParentalPage />} />
              <Route path="/advanced" element={<AdvancedPage />} />
              <Route path="/diagnostics" element={<DiagnosticsPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/system" element={<SystemPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

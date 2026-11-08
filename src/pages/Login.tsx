import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Network,
  Router,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Button, Field, Input, Spinner } from '../components/ui';

export function LoginPage() {
  const { session, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [gateway, setGateway] = useState('10.0.0.1');
  const [detectedGateway, setDetectedGateway] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .gateway()
      .then((info) => {
        if (!active) return;
        setDetectedGateway(info.gateway);
        setGateway(info.gateway);
      })
      .catch(() => {
        /* Keep the manual fallback. */
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">
          <Router size={30} />
        </div>
        <Spinner size={22} />
        <p>Connecting to the local dashboard…</p>
      </div>
    );
  }

  if (session?.authenticated) {
    return <Navigate to="/" replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!username.trim()) {
      setError('Enter the router username.');
      return;
    }
    if (!password) {
      setError('Enter the router password.');
      return;
    }
    if (!gateway.trim()) {
      setError('Enter your router gateway address.');
      return;
    }
    setSubmitting(true);
    try {
      await signIn({ username: username.trim(), password, gateway: gateway.trim() });
      navigate('/', { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-aurora login-aurora-a" />
      <div className="login-aurora login-aurora-b" />

      <section className="login-story">
        <div className="brand brand-large">
          <div className="brand-mark">
            <Router size={24} />
          </div>
          <div className="brand-copy">
            <strong>Xfinity Unlocked</strong>
            <span>Local router console</span>
          </div>
        </div>

        <div className="login-headline">
          <span className="eyebrow">Your gateway, without the clutter</span>
          <h1>
            Every setting.
            <br />
            <em>Finally legible.</em>
          </h1>
          <p>
            A local dashboard for Rogers and Xfinity RDK-B gateways. Inspect the network, manage
            Wi-Fi, and control port forwarding from one place.
          </p>
        </div>

        <ul className="login-features">
          <li>
            <Wifi size={18} />
            <span>Live Wi-Fi, radio, and client details</span>
          </li>
          <li>
            <Network size={18} />
            <span>Full port forwarding controls, including the master switch</span>
          </li>
          <li>
            <ShieldCheck size={18} />
            <span>Credentials stay in memory on this machine</span>
          </li>
        </ul>

        <p className="login-footnote">
          Runs entirely on your computer. Nothing is sent to a third-party service.
        </p>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <header>
            <span className="eyebrow">Secure local session</span>
            <h2>Connect to your router</h2>
            <p>
              Use the same credentials you would enter at{' '}
              <code>http://{gateway || '10.0.0.1'}</code>.
            </p>
          </header>

          {error && (
            <div className="form-error" role="alert">
              <Lock size={16} />
              <span>{error}</span>
            </div>
          )}

          <Field label="Gateway address" hint={detectedGateway ? `Auto-detected ${detectedGateway}` : 'Usually 10.0.0.1'}>
            <div className="input-with-icon">
              <Network size={16} />
              <Input
                value={gateway}
                onChange={(event) => setGateway(event.target.value)}
                inputMode="decimal"
                placeholder="10.0.0.1"
                autoComplete="url"
                spellCheck={false}
              />
            </div>
          </Field>

          <Field label="Username">
            <div className="input-with-icon">
              <KeyRound size={16} />
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="admin"
                spellCheck={false}
              />
            </div>
          </Field>

          <Field label="Password">
            <div className="input-with-icon">
              <Lock size={16} />
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Router password"
              />
              <button
                type="button"
                className="input-icon-button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>

          <Button type="submit" variant="primary" loading={submitting} icon={<ArrowRight size={16} />}>
            {submitting ? 'Connecting…' : 'Connect to router'}
          </Button>

          <div className="login-note">
            <ShieldCheck size={15} />
            <span>
              Your password is held only in this app's server memory for the session. It is never
              written to disk or logged.
            </span>
          </div>
        </form>
      </section>
    </div>
  );
}

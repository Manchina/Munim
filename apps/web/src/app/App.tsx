import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { get, set } from 'idb-keyval';
import type { Me, Product, Customer, Settings, Restock } from '@munim/contracts';
import { api, allPages } from '../lib/api';
import { Counter } from '../features/counter/Counter';
import { Stock } from '../features/stock/Stock';
import { Khata } from '../features/khata/Khata';
import { Maintenance } from '../features/management/Management';
import { Receipt } from '../features/receipts/Receipt';
import { durableWrite, pendingKey, type PendingWrite } from '../lib/mutations';
import { usePwaInstall } from '../lib/usePwaInstall';
export type Data = {
  products: Product[];
  customers: Customer[];
  settings: Settings;
  suppliers: { id: string; name: string; phone: string | null }[];
  restock: Restock[];
  balances: { id: string; name: string; balancePaise: number }[];
};
export type ViewProps = {
  data: Data;
  base: string;
  owner: boolean;
  offline: boolean;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  userId: string;
};
export function Panel({
  children,
  title,
  aside,
}: {
  children: ReactNode;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function App() {
  const [me, setMe] = useState<Me | null>(null),
    [loading, setLoading] = useState(true),
    [offline, setOffline] = useState(!navigator.onLine);
  const [message, setMessage] = useState(''),
    [storeId, setStoreId] = useState(''),
    [data, setData] = useState<Data | null>(null),
    [view, setView] = useState('counter'),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const pwa = usePwaInstall();
  const receiptToken = location.pathname.match(/^\/receipt\/([A-Za-z0-9_-]{43})$/)?.[1];
  const invitation = location.pathname === '/invite' ? location.hash.slice(1) : '';
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const loadUser = useCallback(async () => {
    try {
      const user = await api<Me>('/auth/me');
      setMe(user);
      sessionStorage.setItem('munim-user', JSON.stringify(user));
      setStoreId((old) =>
        user.stores.some((s) => s.storeId === old) ? old : (user.stores[0]?.storeId ?? ''),
      );
      const pendingInvite = sessionStorage.getItem('munim-pending-invite');
      if (pendingInvite && location.pathname !== '/invite')
        location.assign(`/invite#${pendingInvite}`);
    } catch {
      if (!navigator.onLine) {
        const cached = sessionStorage.getItem('munim-user');
        if (cached) {
          const user = JSON.parse(cached) as Me;
          setMe(user);
          setStoreId(user.stores[0]?.storeId ?? '');
        }
      } else {
        setMe(null);
        sessionStorage.removeItem('munim-user');
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!receiptToken) void loadUser();
    else setLoading(false);
  }, [loadUser, receiptToken]);
  useEffect(() => {
    const update = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine && !receiptToken) void loadUser();
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [loadUser, receiptToken]);
  const base = `/stores/${storeId}`;
  const activeScope = useRef('');
  activeScope.current = me ? `catalog:${me.id}:${storeId}` : '';
  const refresh = useCallback(async () => {
    if (!storeId || !me) return;
    const cacheKey = `catalog:${me.id}:${storeId}`;
    if (!navigator.onLine) {
      const cached = await get<Data>(cacheKey);
      if (cached && activeScope.current === cacheKey) setData(cached);
      else setMessage('Go online once to load your store.');
      return;
    }
    const [products, customers, settings, suppliers, restock, balances] = await Promise.all([
      allPages<Product>(`${base}/products`),
      allPages<Customer>(`${base}/customers`),
      api<Settings>(`${base}/settings`),
      allPages<Data['suppliers'][number]>(`${base}/suppliers`),
      allPages<Restock>(`${base}/restock-requests`),
      allPages<Data['balances'][number]>(`${base}/khata`),
    ]);
    const result = { products, customers, settings, suppliers, restock, balances };
    await set(cacheKey, result);
    if (activeScope.current === cacheKey) setData(result);
  }, [base, storeId, me]);
  useEffect(() => {
    setData(null);
    void refresh().catch((e) => setMessage(e.message));
  }, [refresh, offline]);
  if (receiptToken) return <Receipt token={receiptToken} />;
  if (loading)
    return (
      <main className="auth">
        <h1>
          Munim<span>●</span>
        </h1>
        <p>Opening your counter…</p>
      </main>
    );
  if (!me || invitation)
    return (
      <Auth
        invitation={invitation}
        signedIn={Boolean(me)}
        busy={busy}
        message={message}
        onSubmit={(email, password) =>
          run(async () => {
            if (invitation) {
              await api('/auth/accept-invite', 'POST', {
                token: invitation,
                ...(password ? { password } : {}),
              });
              sessionStorage.removeItem('munim-pending-invite');
              history.replaceState(null, '', '/');
            } else await api('/auth/login', 'POST', { email, password });
            await loadUser();
          })
        }
        onSignIn={() => {
          sessionStorage.setItem('munim-pending-invite', invitation);
          history.replaceState(null, '', '/');
          location.reload();
        }}
      />
    );
  const owner = me.stores.find((s) => s.storeId === storeId)?.role === 'owner';
  const props: ViewProps | null =
    data && data.settings.id === storeId
      ? { data, base, owner, offline, busy, run, refresh, notify: setMessage, userId: me.id }
      : null;
  return (
    <>
      <header className="masthead">
        <div>
          <div className="wordmark">
            Munim<span>●</span>
          </div>
          <small>LESS TYPING. MORE DUKAANDAARI.</small>
        </div>
        <div className="store-controls">
          <span className={`connection ${offline ? 'offline' : ''}`}>
            {offline ? 'Offline · draft only' : '● Counter connected'}
          </span>
          <label className="sr-only" htmlFor="store">
            Store
          </label>
          <select id="store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {me.stores.map((s) => (
              <option key={s.storeId} value={s.storeId}>
                {s.name}
              </option>
            ))}
          </select>
          {pwa.canInstall && (
            <button
              className="icon-btn"
              onClick={() => void pwa.install()}
              title="Install Munim app"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Install app
            </button>
          )}
          <button
            className="quiet icon-btn"
            aria-label="Sign out"
            title="Sign out"
            disabled={busy || offline}
            onClick={() =>
              void run(async () => {
                await api('/auth/logout', 'POST');
                sessionStorage.removeItem('munim-user');
                setMe(null);
                setData(null);
              })
            }
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className="intro">
          <div>
            <p className="eyebrow">YOUR EVERYDAY COUNTER COMPANION</p>
            <h1>
              {view === 'counter'
                ? 'A good day starts here.'
                : view === 'stock'
                  ? 'Keep the shelves ready.'
                  : view === 'khata'
                    ? 'Every rupee, remembered.'
                    : 'Make Munim yours.'}
            </h1>
          </div>
          <span className="date">
            {new Intl.DateTimeFormat('en-IN', {
              dateStyle: 'medium',
              timeZone: data?.settings.timezone ?? 'Asia/Kolkata',
            }).format(new Date())}
          </span>
        </div>
        <nav aria-label="Main navigation">
          {[
            ['counter', '01', 'Live Counter'],
            ['stock', '02', 'Stock & Restock'],
            ['khata', '03', 'Khata Ledger'],
            ['manage', '⚙', 'Manage Store'],
          ].map(([id, number, label]) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id!)}>
              <span>{number}</span>
              {label}
            </button>
          ))}
        </nav>
        {message && (
          <div className="notice" role="status">
            <span>{message}</span>
            <button className="quiet" onClick={() => setMessage('')} aria-label="Dismiss message">
              ×
            </button>
          </div>
        )}
        {props && <PendingUpdate {...props} />}
        {!me.stores.length ? (
          <Panel title="No store access">
            <p>Ask your store owner for an invitation.</p>
          </Panel>
        ) : !props ? (
          <Panel title="Loading your store">
            <p>Go online to load your items and khata.</p>
            <button onClick={() => void run(refresh)}>Retry</button>
          </Panel>
        ) : (
          <div hidden={view !== 'counter'}>
            <Counter key={`${me.id}:${storeId}`} {...props} />
          </div>
        )}
        {props && view === 'stock' && <Stock {...props} />}
        {props && view === 'khata' && <Khata {...props} />}
        {props && view === 'manage' && <Maintenance {...props} />}
        <footer>
          Made for the rhythm of your dukaan.
          <span>₹ INR · {data?.products.length ?? 0} items in your store</span>
        </footer>
      </main>
    </>
  );
}
function PendingUpdate(p: ViewProps) {
  const scope = `${p.userId}:${p.data.settings.id}`;
  const [pending, setPending] = useState<PendingWrite | null>(null);
  useEffect(() => {
    void get<PendingWrite>(pendingKey(scope)).then((v) => setPending(v ?? null));
  }, [scope, p.busy]);
  if (!pending) return null;
  return (
    <div className="notice">
      <p>
        One update did not finish saving. Tap Retry before making another stock or khata change.
      </p>
      <button
        disabled={p.busy || p.offline}
        onClick={() =>
          void p.run(async () => {
            await durableWrite(scope, pending.path, pending.body);
            setPending(null);
            await p.refresh();
            p.notify('Store update confirmed.');
          })
        }
      >
        Retry update
      </button>
    </div>
  );
}
function Auth({
  invitation,
  signedIn,
  busy,
  message,
  onSubmit,
  onSignIn,
}: {
  invitation: string;
  signedIn: boolean;
  busy: boolean;
  message: string;
  onSubmit: (email: string, password: string) => Promise<void>;
  onSignIn: () => void;
}) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  return (
    <main className="auth">
      <div className="wordmark">
        Munim<span>●</span>
      </div>
      <p className="eyebrow">YOUR VOICE. YOUR SHOP. YOUR BOOKS.</p>
      <h1>{invitation ? 'Your counter is waiting.' : 'Welcome back, shopkeeper.'}</h1>
      <p>
        {invitation
          ? 'Accept this store invite. If you already have an account, sign in with your invited email first.'
          : 'Sign in to keep sales, stock and udhaar in order.'}
      </p>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void onSubmit(email, password);
        }}
      >
        {!invitation && (
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        )}
        {(!invitation || !signedIn) && (
          <label>
            {invitation ? 'Choose password' : 'Password'}
            <input
              type="password"
              minLength={12}
              maxLength={128}
              required={!signedIn}
              autoComplete={invitation ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'One moment…' : invitation ? 'Accept invitation' : 'Open my counter'}
        </button>
      </form>
      {invitation && !signedIn && (
        <button onClick={onSignIn}>I already have an account — sign in</button>
      )}
      {message && (
        <p role="alert" className="error">
          {message}
        </p>
      )}
      <small>Invite-only access. Ask your store owner if you need an account.</small>
    </main>
  );
}

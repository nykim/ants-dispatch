import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { config } from '../config';
import { listPublicTypes, submitSubscribe } from '../api/endpoints';

export const Route = createFileRoute('/subscribe')({
  component: SubscribePage,
  validateSearch: (search): { type?: string } => ({
    type: typeof search.type === 'string' ? search.type : undefined,
  }),
});

declare global {
  interface Window {
    turnstile?: {
      render: (
        target: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
          theme?: 'auto' | 'light' | 'dark';
          appearance?: 'always' | 'execute' | 'interaction-only';
        },
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

function SubscribePage() {
  const navigate = useNavigate();
  const { type: presetType } = Route.useSearch();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState<string>(presetType ?? '');
  const [hp, setHp] = useState(''); // honeypot
  const [turnstileToken, setTurnstileToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const typesQ = useQuery({
    queryKey: ['public-types'],
    queryFn: listPublicTypes,
  });
  const types = typesQ.data?.items ?? [];

  // Lock the type field when it was preset via the URL — that's the per-type
  // "subscribe to *this* newsletter" link case. Without a preset, show the
  // chooser so visitors landing on the bare /subscribe page can pick.
  const typeLocked = !!presetType;

  // Load Turnstile script + render the widget when a site key is configured.
  useEffect(() => {
    if (!config.turnstileSiteKey) return;
    if (document.querySelector('script[data-turnstile]')) return;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.defer = true;
    s.dataset.turnstile = '1';
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!config.turnstileSiteKey) return;
    const el = turnstileRef.current;
    if (!el) return;
    let cancelled = false;
    const tryRender = () => {
      if (cancelled) return;
      if (!window.turnstile) {
        setTimeout(tryRender, 200);
        return;
      }
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(el, {
        sitekey: config.turnstileSiteKey,
        callback: (token) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      });
    };
    tryRender();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (config.turnstileSiteKey && !turnstileToken) {
      setError('Please complete the captcha.');
      return;
    }
    setSubmitting(true);
    try {
      await submitSubscribe({
        email: email.trim(),
        name: name.trim() || undefined,
        typeId: typeId || undefined,
        website: hp,
        turnstileToken: turnstileToken || undefined,
      });
      navigate({
        to: '/subscribe/pending',
        search: { email: email.trim() },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(msg);
      // Reset Turnstile so the user can re-challenge.
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current);
        setTurnstileToken('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const presetTypeName = presetType
    ? types.find((t) => t.id === presetType)?.name ?? null
    : null;

  return (
    <PublicShell>
      <h1>Subscribe to {config.brand.full}</h1>
      {presetTypeName && (
        <p className="lede">
          You're signing up for <strong>{presetTypeName}</strong>.
        </p>
      )}
      <form onSubmit={onSubmit} className="form">
        <label>
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label>
          <span>Name <em>(optional)</em></span>
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </label>

        {!typeLocked && types.length > 0 && (
          <label>
            <span>Newsletter</span>
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Any (default)</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
        )}

        {/* Honeypot — visually hidden but reachable by bots that auto-fill. */}
        <div className="honeypot" aria-hidden="true">
          <label>
            Website
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={hp}
              onChange={(e) => setHp(e.target.value)}
            />
          </label>
        </div>

        {config.turnstileSiteKey && <div ref={turnstileRef} className="turnstile" />}

        {error && <p className="err">{error}</p>}

        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Subscribing…' : 'Subscribe'}
        </button>
        <p className="muted">
          We'll send you a confirmation email. You can unsubscribe at any time
          from a link in every newsletter.
        </p>
      </form>
    </PublicShell>
  );
}

// Shared shell + minimal styles for the public subscribe / pending /
// confirmed / error pages. Inlined so the SPA's authed CSS bundle stays out
// of these unauthenticated views.
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell">
      <style>{PUBLIC_CSS}</style>
      <div className="card">{children}</div>
    </div>
  );
}

const PUBLIC_CSS = `
  body{margin:0}
  .public-shell{
    min-height:100vh;background:#faf7f1;color:#2a2420;
    font-family:'Source Serif 4',Georgia,serif;
    display:grid;place-items:center;padding:32px 16px;
  }
  .public-shell .card{
    max-width:480px;width:100%;background:#fff;border:1px solid #e6decf;
    border-radius:8px;padding:36px 32px;box-shadow:0 1px 2px rgba(0,0,0,.04);
  }
  .public-shell h1{font-size:24px;margin:0 0 12px;letter-spacing:-.01em}
  .public-shell p{font-size:15px;line-height:1.6;color:#554a40;margin:8px 0}
  .public-shell p.lede{margin-bottom:18px}
  .public-shell strong{color:#2a2420}
  .public-shell em{color:#8a7f70;font-style:normal;font-size:13px}
  .public-shell p.muted{color:#8a7f70;font-size:13px;margin-top:14px}
  .public-shell p.err{color:#9b3b21;font-size:13px;margin-top:8px}
  .public-shell .form{display:flex;flex-direction:column;gap:14px;margin-top:18px}
  .public-shell label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#554a40}
  .public-shell input,.public-shell select{
    font:inherit;font-size:15px;color:#2a2420;background:#faf7f1;
    border:1px solid #e6decf;border-radius:5px;padding:8px 10px;
  }
  .public-shell input:focus,.public-shell select:focus{outline:none;border-color:#9b3b21}
  .public-shell .btn{
    font:inherit;font-size:15px;background:#9b3b21;color:#fff;
    border:none;border-radius:5px;padding:10px 18px;cursor:pointer;font-weight:600;
  }
  .public-shell .btn:hover{background:#7a2d18}
  .public-shell .btn:disabled{opacity:.6;cursor:not-allowed}
  .public-shell .turnstile{margin-top:4px}
  .public-shell .honeypot{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
  .public-shell code{
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f4efe5;
    padding:2px 6px;border-radius:3px;font-size:13px;
  }
`;

import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { t, useLang } from '../lib/i18n.js';

// Pantalla de consentimiento del OAuth 2.1 server de Supabase (conector MCP).
// Supabase redirige aquí con ?authorization_id=… (ver supabase/config.toml /
// dashboard → Authentication → OAuth Server → authorization_url_path). Tres
// resultados posibles de getAuthorizationDetails: detalles a mostrar (consentir),
// un redirect_url ya resuelto (consentimiento previo → seguirlo directo), o error.
export default function OAuthConsent() {
  useLang();
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id');
  const [state, setState] = useState('loading'); // loading | error | consent | redirecting
  const [error, setError] = useState('');
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authorizationId) {
      setState('error');
      setError(t('Falta el parámetro authorization_id.'));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
        if (cancelled) return;
        if (err) {
          setState('error');
          setError(err.message || t('No se pudo cargar la solicitud de autorización.'));
        } else if (data && 'authorization_id' in data) {
          setDetails(data);
          setState('consent');
        } else if (data?.redirect_url) {
          setState('redirecting');
          window.location.href = data.redirect_url;
        } else {
          setState('error');
          setError(t('No se pudo cargar la solicitud de autorización.'));
        }
      } catch (e) {
        if (!cancelled) {
          setState('error');
          setError(e?.message || t('No se pudo cargar la solicitud de autorización.'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authorizationId]);

  async function decide(kind) {
    setBusy(true);
    try {
      const { data, error: err } =
        kind === 'approve'
          ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
          : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (err) {
        setBusy(false);
        setState('error');
        setError(err.message || t('No se pudo cargar la solicitud de autorización.'));
        return;
      }
      setState('redirecting');
      window.location.href = data.redirect_url;
    } catch (e) {
      setBusy(false);
      setState('error');
      setError(e?.message || t('No se pudo cargar la solicitud de autorización.'));
    }
  }

  const scopes = details?.scope ? details.scope.split(/\s+/).filter(Boolean) : [];

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-6 px-6">
      <span className="font-display text-xl tracking-tight">
        nutri<span className="text-accent">.</span>
      </span>

      {(state === 'loading' || state === 'redirecting') && (
        <p className="text-sm text-text-2">{state === 'redirecting' ? t('Redirigiendo…') : t('Cargando…')}</p>
      )}

      {state === 'error' && (
        <div className="w-full max-w-xs flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-danger">{error}</p>
          <Link to="/" className="text-sm text-accent">
            {t('Volver')}
          </Link>
        </div>
      )}

      {state === 'consent' && details && (
        <div className="w-full max-w-xs flex flex-col gap-4">
          <p className="text-sm text-text-2 text-center">
            {t('%n quiere acceder a tu cuenta de nutri.').replace(
              '%n',
              details.client?.name || t('Esta aplicación')
            )}
          </p>
          {scopes.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-2">{t('Permisos solicitados')}</span>
              <ul className="flex flex-col gap-1">
                {scopes.map((s) => (
                  <li key={s} className="text-sm px-3 py-2 rounded-lg border border-border">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={() => decide('approve')}
            disabled={busy}
            className="min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press disabled:opacity-60"
          >
            {t('Aprobar')}
          </button>
          <button
            onClick={() => decide('deny')}
            disabled={busy}
            className="min-h-[44px] rounded-xl border border-border text-text-2 press disabled:opacity-60"
          >
            {t('Denegar')}
          </button>
        </div>
      )}
    </div>
  );
}

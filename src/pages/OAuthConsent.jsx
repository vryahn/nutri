import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { BadgeCheck, Mail, Phone, UserRound, ShieldCheck, Loader2, Check, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { t, useLang } from '../lib/i18n.js';

// Etiqueta legible por scope OIDC (Supabase reporta openid/profile/email/phone).
// Un scope sin entrada cae a su string crudo — nunca se oculta lo que se pide.
const SCOPE_META = {
  openid: { Icon: BadgeCheck, label: 'Verificar tu identidad', desc: 'Confirmar quién eres en nutri' },
  profile: { Icon: UserRound, label: 'Tu perfil', desc: 'Nombre y datos básicos de la cuenta' },
  email: { Icon: Mail, label: 'Tu correo electrónico', desc: 'La dirección con la que inicias sesión' },
  phone: { Icon: Phone, label: 'Tu teléfono', desc: 'Solo si tienes uno registrado' },
};

// Pantalla de consentimiento del OAuth 2.1 server de Supabase (conector MCP).
// Supabase redirige aquí con ?authorization_id=… (dashboard → Authentication →
// OAuth Server → authorization_url_path). getAuthorizationDetails da tres salidas:
// detalles a mostrar (consentir), un redirect_url ya resuelto (consentimiento
// previo → seguirlo directo), o error.
export default function OAuthConsent() {
  useLang();
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id');
  const [state, setState] = useState('loading'); // loading | error | consent | redirecting
  const [error, setError] = useState('');
  const [details, setDetails] = useState(null);
  const [account, setAccount] = useState(null);
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
        const [{ data, error: err }, { data: userData }] = await Promise.all([
          supabase.auth.oauth.getAuthorizationDetails(authorizationId),
          supabase.auth.getUser(),
        ]);
        if (cancelled) return;
        if (userData?.user) setAccount(userData.user);
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
  const clientName = details?.client?.name || t('Esta aplicación');
  const clientInitial = (clientName.trim()[0] || '?').toUpperCase();

  return (
    <div className="min-h-dvh flex items-center justify-center px-5 py-10 bg-bg">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface shadow-lg p-6 sm:p-7 sheet-in">
        <div className="flex justify-center mb-6">
          <span className="font-display text-lg tracking-tight text-text">
            nutri<span className="text-accent">.</span>
          </span>
        </div>

        {(state === 'loading' || state === 'redirecting') && (
          <div className="flex flex-col items-center gap-3 py-10 text-text-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <p className="text-sm">{state === 'redirecting' ? t('Redirigiendo…') : t('Cargando…')}</p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div
              className="w-11 h-11 rounded-full grid place-items-center"
              style={{ background: 'color-mix(in srgb, var(--danger) 15%, transparent)' }}
            >
              <AlertCircle className="w-5 h-5 text-danger" />
            </div>
            <p className="text-sm text-text-2">{error}</p>
            <Link
              to="/"
              className="min-h-[44px] px-5 grid place-items-center rounded-xl border border-border text-sm text-text press"
            >
              {t('Volver')}
            </Link>
          </div>
        )}

        {state === 'consent' && details && (
          <>
            <div className="flex items-center justify-center gap-3 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-surface-2 border border-border grid place-items-center font-display text-xl text-text">
                {clientInitial}
              </div>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-border" />
                <ShieldCheck className="w-4 h-4 text-accent" />
                <span className="w-1.5 h-1.5 rounded-full bg-border" />
              </div>
              <div className="w-14 h-14 rounded-2xl bg-accent-deep grid place-items-center">
                <span className="font-display text-xl text-on-accent">
                  n<span className="opacity-70">.</span>
                </span>
              </div>
            </div>

            <h1 className="text-center text-base font-medium text-text leading-snug">
              {t('%n quiere conectarse a tu cuenta').replace('%n', clientName)}
            </h1>
            <p className="text-center text-sm text-text-2 mt-1.5">
              {t('Podrá registrar y consultar tu información de nutri en tu nombre.')}
            </p>

            {account?.email && (
              <div className="flex items-center gap-2.5 mt-5 px-3 py-2.5 rounded-xl bg-surface-2">
                <div className="w-8 h-8 shrink-0 rounded-full bg-accent-deep grid place-items-center text-on-accent text-sm font-medium">
                  {(account.email[0] || '?').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-text-3 leading-tight">{t('Conectado como')}</p>
                  <p className="text-sm text-text truncate">{account.email}</p>
                </div>
              </div>
            )}

            {scopes.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-medium text-text-3 uppercase tracking-wide mb-1">
                  {t('Permisos solicitados')}
                </p>
                <ul className="flex flex-col">
                  {scopes.map((s, i) => {
                    const meta = SCOPE_META[s];
                    const Icon = meta?.Icon || BadgeCheck;
                    return (
                      <li key={s} className={`flex items-start gap-3 py-2.5 ${i > 0 ? 'border-t border-border' : ''}`}>
                        <Icon className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
                        <div className="min-w-0">
                          <p className="text-sm text-text leading-tight">{meta ? t(meta.label) : s}</p>
                          {meta && <p className="text-xs text-text-2 mt-0.5">{t(meta.desc)}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2.5 mt-6">
              <button
                onClick={() => decide('approve')}
                disabled={busy}
                className="min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {t('Aprobar acceso')}
              </button>
              <button
                onClick={() => decide('deny')}
                disabled={busy}
                className="min-h-[44px] rounded-xl border border-border text-text-2 press disabled:opacity-60"
              >
                {t('Denegar')}
              </button>
            </div>

            <p className="flex items-center justify-center gap-1.5 mt-5 text-[11px] text-text-3 text-center">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              {t('Podrás revocar este acceso cuando quieras.')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

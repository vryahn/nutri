import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import ConfirmSheet from '../components/ConfirmSheet.jsx';
import { t, locale, useLang } from '../lib/i18n.js';
import { MCP_CAPABILITIES } from '../lib/mcp.js';
import { supabase } from '../lib/supabase.js';

const CONNECTOR_URL = 'https://nutri.vryahn.com/api/mcp';
const CARD = 'rounded-2xl border border-border bg-surface p-4 space-y-3';
const BUTTON = 'min-h-[44px] rounded-xl border border-border px-3 text-sm text-text press';

function CopyBlock({ value, label }) {
  const [feedback, setFeedback] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setFeedback('Copiado');
      timer.current = setTimeout(() => setFeedback(''), 2000);
    } catch {
      setFeedback('No se pudo copiar.');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-2 pl-3">
        <code className="min-w-0 flex-1 break-all font-mono text-sm">{value}</code>
        <button type="button" className={`${BUTTON} shrink-0`} aria-label={t(label)} onClick={copy}>
          {feedback === 'Copiado' ? t(feedback) : t('Copiar')}
        </button>
      </div>
      <span className={feedback === 'No se pudo copiar.' ? 'text-sm text-danger' : 'sr-only'} role="status">
        {feedback && t(feedback)}
      </span>
    </div>
  );
}

export default function Agents() {
  useLang();
  const [account, setAccount] = useState(null);
  const [grants, setGrants] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (!active) return;
        if (error || !data?.user) throw error || new Error('Missing user');
        setAccount(data.user);
        if (data.user.is_anonymous) return;

        const { data: list, error: listError } = await supabase.auth.oauth.listGrants();
        if (!active) return;
        if (listError) throw listError;
        setGrants(list.map((grant) => {
          const id = grant.client?.id || grant.client_id;
          return { id, name: grant.client?.name || id, date: grant.granted_at };
        }));
      } catch {
        if (active) setLoadError(true);
      }
    }
    load();
    return () => { active = false; };
  }, [attempt]);

  function retry() {
    setLoadError(false);
    setAttempt((previous) => previous + 1);
  }

  async function revoke() {
    setRevoking(true);
    try {
      const { error } = await supabase.auth.oauth.revokeGrant({ clientId: selected.id });
      if (error) throw error;
      setGrants((list) => list.filter(({ id }) => id !== selected.id));
    } catch {
      setRevokeError(true);
    } finally {
      setRevoking(false);
      setSelected(null);
    }
  }

  const loadingFailed = loadError && (
    <div className="space-y-2">
      <p className="text-sm text-danger" role="alert">{t('No se pudo cargar la lista. Reintenta.')}</p>
      <button type="button" className={BUTTON} onClick={retry}>{t('Reintentar')}</button>
    </div>
  );
  const loading = <p className="text-sm text-text-2" role="status">{t('Cargando…')}</p>;

  if (account?.is_anonymous) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-4">
        <p className={CARD}>{t('Los agentes de IA requieren una cuenta permanente. La demo no puede conectarse.')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 space-y-4">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold">{t('Conectar un agente de IA')}</h1>
        {account && (
          <p className="break-all text-sm text-text-2">
            {t('Sesión: %email').replace('%email', () => account.email || t('Sin correo electrónico'))}
          </p>
        )}
      </header>

      {!account && (loadingFailed || loading)}
      {account && (
        <>
          <section className={CARD}>
            <h2 className="font-display text-lg">{t('URL del conector')}</h2>
            <CopyBlock value={CONNECTOR_URL} label="Copiar URL del conector" />
            <p className="text-sm text-text-2">{t('Es pública: no es una contraseña. Nadie entra sin tu aprobación.')}</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>{t('Añade un conector personalizado con esta URL en tu agente')}</li>
              <li>{t('Inicia sesión en Nutri cuando te lo pida')}</li>
              <li>{t('Revisa el acceso y pulsa Permitir')}</li>
            </ol>
            <div className="flex flex-wrap items-center gap-x-4 text-sm">
              <p>{t('Guías oficiales:')}</p>
              <a className="inline-flex min-h-[44px] items-center text-accent underline" target="_blank" rel="noopener noreferrer" href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp">{t('Claude')}</a>
              <a className="inline-flex min-h-[44px] items-center text-accent underline" target="_blank" rel="noopener noreferrer" href="https://developers.openai.com/api/docs/guides/custom-mcp-server">{t('ChatGPT')}</a>
            </div>
          </section>

          <section className={CARD}>
            <h2 className="font-display text-lg">{t('Claude Code')}</h2>
            <CopyBlock value={`claude mcp add --transport http nutri ${CONNECTOR_URL}`} label="Copiar comando de Claude Code" />
            <p className="text-sm text-text-2">{t('Luego ejecuta /mcp para autenticarte.')}</p>
          </section>

          <section className={CARD}>
            <h2 className="font-display text-lg">{t('Las herramientas de Nutri permiten:')}</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {MCP_CAPABILITIES.map((capability) => <li key={capability}>{t(capability)}</li>)}
            </ul>
            <p className="flex gap-2 rounded-xl border border-warn p-3 text-sm">
              <AlertTriangle size={18} className="shrink-0 text-warn" aria-hidden="true" />
              {t('La autorización da acceso a tu cuenta como si fueras tú: aprueba solo agentes en los que confíes. Nunca pegues tu contraseña ni un token en un chat.')}
            </p>
          </section>

          <section className={CARD}>
            <h2 className="font-display text-lg">{t('Aplicaciones autorizadas')}</h2>
            {loadingFailed || (!grants && loading)}
            {grants?.length === 0 && <p className="text-sm text-text-2">{t('Aún no has autorizado ningún agente.')}</p>}
            {grants?.length > 0 && (
              <ul className="divide-y divide-border">
                {grants.map((grant) => (
                  <li key={grant.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0 break-words">
                      <p>{grant.name}</p>
                      {grant.date && (
                        <time className="text-sm text-text-2" dateTime={grant.date}>
                          {new Date(grant.date).toLocaleDateString(locale(), { dateStyle: 'medium' })}
                        </time>
                      )}
                    </div>
                    <button type="button" className={`${BUTTON} shrink-0`} onClick={() => { setRevokeError(false); setSelected(grant); }}>
                      {t('Revocar')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {revokeError && <p className="text-sm text-danger" role="alert">{t('No se pudo revocar el acceso. Reintenta.')}</p>}
          </section>
        </>
      )}

      {selected && (
        <ConfirmSheet
          title={<span className="break-words">{t('¿Revocar acceso de %n?').replace('%n', () => selected.name)}</span>}
          body={t('Dejará de poder renovar su acceso. Su acceso actual puede seguir funcionando hasta que caduque. Podrás volver a autorizarlo.')}
          confirmLabel={t('Revocar')}
          onConfirm={revoke}
          onClose={() => { if (!revoking) setSelected(null); }}
        />
      )}
    </div>
  );
}

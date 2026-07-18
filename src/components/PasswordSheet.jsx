import { useState } from 'react';
import { Lock, Eye, EyeOff, Check } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { t } from '../lib/i18n.js';
import Sheet from './Sheet.jsx';

const MIN = 6; // Supabase Auth default minimum
const inputCls = 'h-[42px] w-full rounded-xl bg-black/25 border border-border pl-3 pr-11 text-sm text-text placeholder:text-text-3 focus:border-accent-deep outline-none';

// Password field with visibility toggle. autoComplete="new-password"
// so the password manager offers to save/generate instead of autofilling the current one.
function PwdField({ label, value, onChange, show, onToggle }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-text-3 font-medium">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? t('Ocultar contraseña') : t('Mostrar contraseña')}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-text-3 press"
        >
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </label>
  );
}

// Password change for the active session: supabase.auth.updateUser({ password }).
// This is NOT the self-service email reset (out of scope, §11) — this one requires an
// open session. The session is already authenticated, so the current password is not re-requested.
export default function PasswordSheet({ onClose }) {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [showC, setShowC] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const tooShort = pwd.length > 0 && pwd.length < MIN;
  const mismatch = confirm.length > 0 && confirm !== pwd;
  const valid = pwd.length >= MIN && confirm === pwd;

  async function submit() {
    if (!valid || loading) return;
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setLoading(false);
    if (error) {
      setError(/different/i.test(error.message)
        ? t('La nueva contraseña debe ser distinta de la actual.')
        : t('No se pudo actualizar la contraseña. Intenta de nuevo.'));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <Sheet
        title={t('Cambiar contraseña')}
        onClose={onClose}
        footer={<button onClick={onClose} className="w-full min-h-[46px] rounded-xl bg-accent-deep text-on-accent font-medium press">{t('Listo')}</button>}
      >
        <div className="flex flex-col items-center gap-2.5 py-6 text-center">
          <Check size={40} className="text-ok" />
          <p className="font-display text-[16px]">{t('Contraseña actualizada')}</p>
          <p className="text-xs text-text-3">{t('Úsala la próxima vez que inicies sesión.')}</p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={t('Cambiar contraseña')}
      onClose={onClose}
      footer={
        <button
          onClick={submit}
          disabled={!valid || loading}
          className="w-full min-h-[46px] rounded-xl bg-accent-deep text-on-accent font-medium press disabled:opacity-60"
        >
          {loading ? t('Actualizando…') : t('Actualizar contraseña')}
        </button>
      }
    >
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-black/15 p-3">
        <Lock size={18} className="text-text-3 flex-none" />
        <p className="text-[12px] text-text-3">{t('Cambia la contraseña de tu cuenta. Se aplica de inmediato.')}</p>
      </div>

      <PwdField label={t('Nueva contraseña')} value={pwd} onChange={setPwd} show={show} onToggle={() => setShow((s) => !s)} />
      <PwdField label={t('Confirmar contraseña')} value={confirm} onChange={setConfirm} show={showC} onToggle={() => setShowC((s) => !s)} />

      {tooShort && <p className="text-xs text-text-3 -mt-1">{t('Mínimo 6 caracteres')}</p>}
      {mismatch && <p className="text-sm text-danger -mt-1">{t('Las contraseñas no coinciden')}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </Sheet>
  );
}

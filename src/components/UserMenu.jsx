import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Monitor, Sun, Moon, User, Globe, SlidersHorizontal, Wand2, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useOutsideClose } from '../lib/useOutsideClose.js';
import { MODES, getMode, setMode } from '../lib/theme.js';
import { t, useLang, useProfile, displayName } from '../lib/i18n.js';
import ProfileSheet from './ProfileSheet.jsx';
import RegionSheet from './RegionSheet.jsx';
import SettingsSheet from './SettingsSheet.jsx';
import TargetsWizard from './TargetsWizard.jsx';

const THEME_META = { system: { icon: Monitor, label: 'Auto' }, light: { icon: Sun, label: 'Claro' }, dark: { icon: Moon, label: 'Oscuro' } };

// Profile avatar: signed photo from the private bucket or, if none exists, the app logo.
// The icon already carries its own full-bleed background (#071010), so it fills the circle. `size` in px.
export function Avatar({ url, size = 34, className = '' }) {
  return (
    <span className={`flex-none rounded-full overflow-hidden block ${className}`} style={{ width: size, height: size }}>
      <img src={url || '/icon.svg'} alt="" className="w-full h-full object-cover" />
    </span>
  );
}

// User menu: an avatar replaces the cluster of icons in the chrome. It opens a
// glass panel (identity + quick theme + Profile / Language / Settings / sign out).
// The dropdown is `absolute` (like MoreOptions): inside the .glass header a
// `fixed` backdrop would anchor to the header, not the screen. The sheets ARE
// full-screen, so they render through a portal to <body> — outside that ancestor.
export default function UserMenu({ placement = 'bottom', className, showLabel = false }) {
  useLang();
  const profile = useProfile();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(null); // 'perfil' | 'idioma' | 'config' | null
  const [mode, setLocalMode] = useState(getMode);
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const ref = useOutsideClose(open, setOpen);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || ''));
  }, []);

  // Signs the avatar photo (private bucket). Re-signed whenever the path changes.
  useEffect(() => {
    let alive = true;
    if (!profile.avatar_path) { setAvatarUrl(null); return; }
    supabase.storage.from('body-photos').createSignedUrl(profile.avatar_path, 3600).then(({ data }) => {
      if (alive) setAvatarUrl(data?.signedUrl || null);
    });
    return () => { alive = false; };
  }, [profile.avatar_path]);

  const openSheet = (which) => { setOpen(false); setSheet(which); };
  const dropPos = placement === 'right' ? 'left-full bottom-0 ml-2' : 'top-full right-0 mt-2';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={className}
        aria-label={t('Menú de usuario')}
        aria-expanded={open}
      >
        <Avatar url={avatarUrl} size={showLabel ? 26 : 32} className={open ? 'ring-2 ring-accent' : ''} />
        {showLabel && <span className="text-sm">{displayName()}</span>}
      </button>

      {open && (
        <div className={`absolute z-50 w-64 rounded-2xl border border-border p-1.5 shadow-lg glass ${dropPos}`}>
          <div className="flex items-center gap-3 px-2.5 py-2">
            <Avatar url={avatarUrl} size={42} />
            <div className="min-w-0">
              <p className="font-display font-semibold text-[15px] leading-tight truncate">{displayName()}</p>
              {email && <p className="text-[11px] text-text-3 font-mono truncate mt-0.5">{email}</p>}
            </div>
          </div>

          <div className="flex gap-1 mx-1 mb-1.5 p-1 rounded-xl bg-black/25">
            {MODES.map((m) => {
              const { icon: Icon, label } = THEME_META[m];
              const on = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => { setMode(m); setLocalMode(m); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11.5px] font-medium press ${on ? 'bg-accent-deep text-on-accent' : 'text-text-2'}`}
                  aria-pressed={on}
                >
                  <Icon size={14} />{t(label)}
                </button>
              );
            })}
          </div>

          <div className="h-px bg-border mx-1 my-1" />
          <MenuItem icon={User} label={t('Perfil')} onClick={() => openSheet('perfil')} />
          <MenuItem icon={Globe} label={t('Idioma y unidades')} onClick={() => openSheet('idioma')} />
          <MenuItem icon={SlidersHorizontal} label={t('Configuración')} onClick={() => openSheet('config')} />
          <MenuItem icon={Wand2} label={t('Asistente de metas')} onClick={() => openSheet('wizard')} />
          <div className="h-px bg-border mx-1 my-1" />
          <MenuItem icon={LogOut} label={t('Cerrar sesión')} danger onClick={() => supabase.auth.signOut()} />
        </div>
      )}

      {sheet && createPortal(
        sheet === 'perfil' ? <ProfileSheet avatarUrl={avatarUrl} onClose={() => setSheet(null)} />
          : sheet === 'idioma' ? <RegionSheet onClose={() => setSheet(null)} />
            : sheet === 'wizard' ? <TargetsWizard onClose={() => setSheet(null)} />
              : <SettingsSheet onClose={() => setSheet(null)} />,
        document.body
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm press text-left hover:bg-surface-2 ${danger ? 'text-danger' : 'text-text'}`}
    >
      <Icon size={19} className={danger ? 'text-danger' : 'text-text-2'} />
      <span>{label}</span>
    </button>
  );
}

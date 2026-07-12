import { useState } from 'react';
import { Camera } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { toJpegBlob } from '../lib/ai.js';
import { t, getProfile, setProfile } from '../lib/i18n.js';
import { Avatar } from './UserMenu.jsx';
import Sheet from './Sheet.jsx';

const SEXES = [
  { key: 'm', label: 'Masculino' },
  { key: 'f', label: 'Femenino' },
  { key: 'x', label: 'Prefiero no decir' },
];

// Campo de texto/numérico controlado (mismo look que el resto de la app).
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-text-3 font-medium">{label}</span>
      {children}
    </label>
  );
}
const inputCls = 'h-[42px] rounded-xl bg-black/25 border border-border px-3 text-sm text-text placeholder:text-text-3 focus:border-accent-deep outline-none';

export default function ProfileSheet({ avatarUrl, onClose }) {
  const [form, setForm] = useState(() => ({ ...getProfile() }));
  const [localUrl, setLocalUrl] = useState(avatarUrl); // preview inmediato tras subir
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function onPickPhoto(fileList) {
    const file = Array.from(fileList || [])[0];
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;
      const blob = await toJpegBlob(file, 512); // avatar pequeño: 512px basta
      const path = `${uid}/avatar/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from('body-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) return;
      if (form.avatar_path) supabase.storage.from('body-photos').remove([form.avatar_path]); // limpia la anterior
      set('avatar_path', path);
      const { data } = await supabase.storage.from('body-photos').createSignedUrl(path, 3600);
      setLocalUrl(data?.signedUrl || null);
    } finally {
      setUploading(false);
    }
  }

  const save = () => {
    // Solo strings/valores limpios; campos vacíos se descartan para no guardar ''.
    const clean = {};
    for (const [k, v] of Object.entries(form)) if (v !== '' && v != null) clean[k] = v;
    setProfile(clean);
    onClose();
  };

  return (
    <Sheet
      title={t('Perfil')}
      onClose={onClose}
      footer={<button onClick={save} className="w-full min-h-[46px] rounded-xl bg-accent-deep text-on-accent font-medium press">{t('Guardar perfil')}</button>}
    >
      <div className="flex items-center gap-4">
        <label className="relative cursor-pointer">
          <Avatar url={localUrl} size={66} />
          <span className="absolute -right-1 -bottom-1 w-7 h-7 rounded-full bg-accent-deep border-2 border-surface flex items-center justify-center">
            <Camera size={14} className="text-on-accent" />
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => onPickPhoto(e.target.files)} />
        </label>
        <div>
          <p className="font-display font-semibold text-[15px]">{t('Foto de perfil')}</p>
          <p className="text-xs text-text-3 mt-0.5">{uploading ? t('Subiendo…') : t('Se usa como avatar del menú.')}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('Nombre')}><input className={inputCls} value={form.first_name || ''} onChange={(e) => set('first_name', e.target.value)} placeholder="Bryan" /></Field>
        <Field label={t('Segundo nombre')}><input className={inputCls} value={form.middle_name || ''} onChange={(e) => set('middle_name', e.target.value)} placeholder="—" /></Field>
      </div>
      <Field label={t('Apellidos')}><input className={inputCls} value={form.last_name || ''} onChange={(e) => set('last_name', e.target.value)} placeholder="Rodríguez" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('Nacimiento')}><input type="date" className={`${inputCls} font-mono`} value={form.dob || ''} onChange={(e) => set('dob', e.target.value)} /></Field>
        <Field label={t('Altura (cm)')}><input type="number" inputMode="decimal" className={`${inputCls} font-mono`} value={form.height_cm ?? ''} onChange={(e) => set('height_cm', e.target.value === '' ? '' : Number(e.target.value))} placeholder="178" /></Field>
      </div>
      <Field label={t('Sexo')}>
        <div className="flex gap-1.5 p-1 rounded-xl bg-black/25 border border-border">
          {SEXES.map((s) => (
            <button
              key={s.key}
              onClick={() => set('sex', s.key)}
              className={`flex-1 py-2 rounded-lg text-[13px] font-medium press ${form.sex === s.key ? 'bg-accent-deep text-on-accent' : 'text-text-2'}`}
            >
              {t(s.label)}
            </button>
          ))}
        </div>
      </Field>
    </Sheet>
  );
}

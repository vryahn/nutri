import { useRef, useState } from 'react';
import { Camera, Trash2, ZoomIn, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { loadImage } from '../lib/ai.js';
import { t, getProfile, setProfile } from '../lib/i18n.js';
import { Avatar } from './UserMenu.jsx';
import Sheet from './Sheet.jsx';
import PasswordSheet from './PasswordSheet.jsx';

const SEXES = [
  { key: 'm', label: 'Masculino' },
  { key: 'f', label: 'Femenino' },
  { key: 'x', label: 'Prefiero no decir' },
];

const VP = 240; // side length of the crop viewport in px (on screen)
const OUT = 512; // side length of the square JPEG that gets uploaded (the Avatar circle crops it)

// Controlled text/numeric field (same look as the rest of the app).
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-text-3 font-medium">{label}</span>
      {children}
    </label>
  );
}
const inputCls = 'h-[42px] rounded-xl bg-black/25 border border-border px-3 text-sm text-text placeholder:text-text-3 focus:border-accent-deep outline-none';

// Crop editor: the user moves (drags) and zooms (slider) the image
// inside a circle; on save, the visible square is baked to an OUT×OUT JPEG.
// This way the Avatar keeps using object-cover with no per-render positioning logic.
function Cropper({ img, onCancel, onDone }) {
  const cover = Math.max(VP / img.naturalWidth, VP / img.naturalHeight); // minimum scale that covers
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: (VP - img.naturalWidth * cover) / 2, y: (VP - img.naturalHeight * cover) / 2 });
  const drag = useRef(null);

  const scale = cover * zoom;
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  // Keeps the image covering the viewport (no gaps).
  const clamp = (x, y) => ({ x: Math.min(0, Math.max(VP - w, x)), y: Math.min(0, Math.max(VP - h, y)) });

  const onPointerDown = (e) => {
    drag.current = { px: e.clientX, py: e.clientY, ...pos };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer (tests): panning does not need it */ }
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setPos(clamp(drag.current.x + (e.clientX - drag.current.px), drag.current.y + (e.clientY - drag.current.py)));
  };
  const onPointerUp = () => { drag.current = null; };

  const onZoom = (z) => {
    // Zooms relative to the viewport center so the framing does not drift.
    const s0 = cover * zoom, s1 = cover * z;
    const fx = (VP / 2 - pos.x) / s0, fy = (VP / 2 - pos.y) / s0; // natural-coordinate point under the center
    const nx = VP / 2 - fx * s1, ny = VP / 2 - fy * s1;
    const nw = img.naturalWidth * s1, nh = img.naturalHeight * s1;
    setZoom(z);
    setPos({ x: Math.min(0, Math.max(VP - nw, nx)), y: Math.min(0, Math.max(VP - nh, ny)) });
  };

  const bake = () => {
    const c = document.createElement('canvas');
    c.width = OUT; c.height = OUT;
    // Source region = what falls inside the viewport, in the image's natural px.
    const sx = -pos.x / scale, sy = -pos.y / scale, side = VP / scale;
    c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, OUT, OUT);
    c.toBlob((blob) => onDone(blob), 'image/jpeg', 0.85);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative mx-auto rounded-xl overflow-hidden touch-none select-none cursor-grab active:cursor-grabbing bg-black/40"
        style={{ width: VP, height: VP }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img
          src={img.src}
          alt=""
          draggable="false"
          className="absolute max-w-none pointer-events-none"
          style={{ left: pos.x, top: pos.y, width: w, height: h }}
        />
        <div className="absolute inset-0 rounded-full pointer-events-none" style={{ boxShadow: '0 0 0 999px rgba(0,0,0,0.55)' }} />
        <div className="absolute inset-0 rounded-full border-2 border-white/80 pointer-events-none" />
      </div>
      <div className="flex items-center gap-2.5">
        <ZoomIn size={16} className="text-text-3 flex-none" />
        <input
          type="range" min="1" max="3" step="0.02" value={zoom}
          onChange={(e) => onZoom(Number(e.target.value))}
          aria-label={t('Acercar')} className="flex-1"
        />
      </div>
      <p className="text-xs text-text-3 text-center">{t('Arrastra para reposicionar')}</p>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 min-h-[44px] rounded-xl border border-border text-text-2 font-medium press">{t('Cancelar')}</button>
        <button onClick={bake} className="flex-1 min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press">{t('Guardar')}</button>
      </div>
    </div>
  );
}

export default function ProfileSheet({ avatarUrl, onClose }) {
  const [form, setForm] = useState(() => ({ ...getProfile() }));
  const [localUrl, setLocalUrl] = useState(avatarUrl); // immediate preview after uploading
  const [uploading, setUploading] = useState(false);
  const [trash, setTrash] = useState([]); // storage paths to delete ON SAVE (deleting them earlier broke the avatar if the user cancelled)
  const [cropImg, setCropImg] = useState(null); // Image being edited, or null
  const [showPwd, setShowPwd] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function onPickFile(fileList) {
    const file = Array.from(fileList || [])[0];
    if (!file || !file.type.startsWith('image/')) return;
    setCropImg(await loadImage(URL.createObjectURL(file))); // opens the cropper
  }

  async function uploadBlob(blob) {
    if (!blob) return;
    setCropImg(null);
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;
      const path = `${uid}/avatar/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from('body-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) return;
      if (form.avatar_path) setTrash((ts) => [...ts, form.avatar_path]); // the previous one is cleaned up on save
      set('avatar_path', path);
      const { data } = await supabase.storage.from('body-photos').createSignedUrl(path, 3600);
      setLocalUrl(data?.signedUrl || null);
    } finally {
      setUploading(false);
    }
  }

  function removePhoto() {
    if (form.avatar_path) setTrash((ts) => [...ts, form.avatar_path]);
    set('avatar_path', null);
    setLocalUrl(null);
  }

  const save = () => {
    // Only clean strings/values; empty/null fields are discarded so '' is never saved.
    // avatar_path=null is discarded here, and since setProfile REPLACES the profile, removing the photo persists.
    const clean = {};
    for (const [k, v] of Object.entries(form)) if (v !== '' && v != null) clean[k] = v;
    setProfile(clean);
    // ponytail: replaced or removed JPEGs are deleted only on confirm. If the
    // user uploads a new one and cancels the sheet, that file is left orphaned in the
    // bucket (accepted leak: deleting the old one before saving left the avatar broken).
    if (trash.length) supabase.storage.from('body-photos').remove(trash);
    onClose();
  };

  const footer = cropImg
    ? null
    : <button onClick={save} className="w-full min-h-[46px] rounded-xl bg-accent-deep text-on-accent font-medium press">{t('Guardar perfil')}</button>;

  return (
    <Sheet title={t('Perfil')} onClose={onClose} footer={footer}>
      {cropImg ? (
        <Cropper img={cropImg} onCancel={() => setCropImg(null)} onDone={uploadBlob} />
      ) : (
        <>
          <div className="flex items-center gap-4">
            <label className="relative cursor-pointer">
              <Avatar url={localUrl} size={66} />
              <span className="absolute -right-1 -bottom-1 w-7 h-7 rounded-full bg-accent-deep border-2 border-surface flex items-center justify-center">
                <Camera size={14} className="text-on-accent" />
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onPickFile(e.target.files)} />
            </label>
            <div className="min-w-0">
              <p className="font-display font-semibold text-[15px]">{t('Foto de perfil')}</p>
              <p className="text-xs text-text-3 mt-0.5">{uploading ? t('Subiendo…') : t('Se usa como avatar del menú.')}</p>
              {localUrl && !uploading && (
                <button onClick={removePhoto} className="mt-1.5 inline-flex items-center gap-1 text-xs text-danger press">
                  <Trash2 size={13} />{t('Quitar foto')}
                </button>
              )}
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

          <div className="h-px bg-border" />
          <button
            onClick={() => setShowPwd(true)}
            className="flex items-center gap-3 rounded-xl px-1 py-2 text-sm text-text press"
          >
            <KeyRound size={19} className="text-text-2" />
            <span>{t('Cambiar contraseña')}</span>
            <span className="ml-auto text-text-3">›</span>
          </button>

          {showPwd && <PasswordSheet onClose={() => setShowPwd(false)} />}
        </>
      )}
    </Sheet>
  );
}

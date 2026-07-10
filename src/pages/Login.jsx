import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError('Email o contraseña incorrectos.');
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-3">
        <svg width="72" height="72" viewBox="0 0 512 512" aria-label="Nutrimetry">
          {/* Colores de marca, no tokens: el tile del logo es oscuro en ambos temas
              (igual que public/icon.svg). Si cambia la paleta, cambian los dos. */}
          <rect width="512" height="512" rx="96" fill="#101A1A" />
          <g transform="translate(-20,0)">
            <rect x="150" y="137" width="46" height="215" rx="6" fill="#E9F7F6" />
            <rect x="294" y="232" width="46" height="120" rx="6" fill="#E9F7F6" />
            <path d="M150 232 A95 95 0 0 1 340 232 L294 232 A49 49 0 0 0 196 232 Z" fill="#E9F7F6" />
            <circle cx="360" cy="330" r="24" fill="#069C92" />
          </g>
        </svg>
        <span className="font-display text-xl tracking-tight">
          nutri<span className="text-accent">.</span>
        </span>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-xs flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm text-text-2">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm text-text-2">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press disabled:opacity-60"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

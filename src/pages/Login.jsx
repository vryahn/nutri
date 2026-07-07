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
      <svg width="64" height="64" viewBox="0 0 64 64" aria-label="nutri.">
        <rect width="64" height="64" rx="16" fill="#0C2A36" />
        <text x="32" y="40" textAnchor="middle" fontFamily="Fraunces, serif" fontWeight="600" fontSize="26" fill="#FAFAF9">
          BR
        </text>
        <circle cx="49" cy="46" r="3" fill="#C2410C" />
      </svg>

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
            className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
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
            className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="min-h-[44px] rounded-xl bg-accent-deep text-text font-medium active:scale-[0.98] transition-transform duration-150 disabled:opacity-60"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

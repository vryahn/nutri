import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'nutri' } }
);

// Modo demo (anonymous sign-in): bandera SÍNCRONA para que cualquier módulo la
// consulte sin await (ai.js, Body.jsx, AiDataCard). La única fuente es el claim
// is_anonymous del JWT. La suscripción se registra al cargar el módulo —antes que
// la de App.jsx—, así que la bandera ya está puesta cuando App re-renderiza.
let demo = false;
let seeding = false;

export const isDemo = () => demo;

// true solo mientras seed_demo() puebla la cuenta anónima recién creada: la app
// no debe montarse a medias con datos vacíos (Login se queda en pantalla y al
// terminar recarga en /).
export const isSeedingDemo = () => seeding;
export const setSeedingDemo = (v) => { seeding = v; };

if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((_event, session) => {
    demo = !!session?.user?.is_anonymous;
  });
}

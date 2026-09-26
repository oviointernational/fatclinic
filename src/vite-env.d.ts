/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://abcdefghijklm.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon / publishable key. Public by design; safe only with RLS. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

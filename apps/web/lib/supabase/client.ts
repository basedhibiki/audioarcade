// apps/web/lib/supabase/client.ts
'use client';

import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr'




export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anonKey);
}

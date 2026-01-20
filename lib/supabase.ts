import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Make auth state stick across refresh/navigation
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,

    // PKCE is more robust for magic links than implicit hash flow
    flowType: "pkce",

    // Avoid clashes if you have multiple Supabase projects locally
    storageKey: "gym-pwa-auth",
  },
});

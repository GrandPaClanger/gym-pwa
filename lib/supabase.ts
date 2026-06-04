import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REQUEST_TIMEOUT_MS = 12000;

const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const upstreamSignal = init?.signal;

  if (upstreamSignal?.aborted) controller.abort(upstreamSignal.reason);

  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  const timeout = globalThis.setTimeout(() => {
    controller.abort(new DOMException("Supabase request timed out.", "TimeoutError"));
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
  global: {
    fetch: fetchWithTimeout,
  },
});

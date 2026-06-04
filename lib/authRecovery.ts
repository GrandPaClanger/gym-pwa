"use client";

import { supabase } from "@/lib/supabase";

export async function localSignOut() {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (error) {
    console.error("Local sign out failed", error);
  }
}

export function installAuthRecovery(onSignedOut?: () => void) {
  let refreshing = false;

  const recover = () => {
    if (refreshing || typeof document === "undefined") return;
    if (document.visibilityState === "hidden") return;

    refreshing = true;
    void supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (error || !data.session) {
          onSignedOut?.();
          return;
        }

        const expiresAtMs = (data.session.expires_at ?? 0) * 1000;
        if (expiresAtMs && expiresAtMs - Date.now() < 5 * 60 * 1000) {
          const refreshed = await supabase.auth.refreshSession();
          if (refreshed.error || !refreshed.data.session) onSignedOut?.();
        }
      })
      .catch((error) => {
        console.error("Auth recovery failed", error);
      })
      .finally(() => {
        refreshing = false;
      });
  };

  window.addEventListener("focus", recover);
  window.addEventListener("online", recover);
  document.addEventListener("visibilitychange", recover);

  return () => {
    window.removeEventListener("focus", recover);
    window.removeEventListener("online", recover);
    document.removeEventListener("visibilitychange", recover);
  };
}

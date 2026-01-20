"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (!code) {
        router.replace("/log");
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);

      // Whether success or fail, move on (fail will land you at /log)
      router.replace(error ? "/log" : "/");
    })();
  }, [router]);

  return (
    <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <h1>Signing you in…</h1>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Signing you in…");

  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      const errDesc = url.searchParams.get("error_description");

      if (err) {
        setMsg(`${err}: ${errDesc ?? ""}`);
        return;
      }

      if (!code) {
        setMsg("Missing ?code= in callback URL (redirect misconfigured).");
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        setMsg(`exchange failed: ${error.message}`);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setMsg("Exchange succeeded but session is still null (persistSession/storage issue).");
        return;
      }

      router.replace("/");
    })();
  }, [router]);

  return (
    <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <h1>Auth callback</h1>
      <p>{msg}</p>
    </main>
  );
}

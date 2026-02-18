"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Signing you in…");

  useEffect(() => {
    (async () => {
      // With implicit + detectSessionInUrl, tokens are parsed automatically
      await new Promise((r) => setTimeout(r, 50));

      const { data, error } = await supabase.auth.getSession();
      if (error) return setMsg(error.message);
      if (!data.session) return setMsg("No session found after callback.");

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

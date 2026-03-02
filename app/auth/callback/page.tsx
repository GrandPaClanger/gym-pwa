"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const code = new URLSearchParams(window.location.search).get("code");

      if (!code) {
        setError("No authentication code found in URL.");
        return;
      }

      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

      if (exchangeError) {
        setError(exchangeError.message);
        return;
      }

      router.replace("/");
    })();
  }, [router]);

  return (
    <main className="min-h-screen bg-gym-bg flex items-center justify-center p-4">
      <div className="card max-w-sm w-full text-center space-y-4">
        {!error ? (
          <>
            <div className="flex justify-center">
              <svg
                className="animate-spin h-8 w-8 text-blue-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <p className="text-slate-300">Signing you in…</p>
          </>
        ) : (
          <>
            <p className="text-red-400">{error}</p>
            <Link href="/log" className="btn-primary">
              Back to login
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

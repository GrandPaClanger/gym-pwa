"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type PlanRow = {
  plan_date: string;
  sequence_no: number;
  exercise_name: string;
  exercise_type: number; // 1 strength, 2 cardio
  target_sets: number | null;
  target_reps: number | null;
  target_duration_sec: number | null;
  suggested_load_kg: number | null;
};

function ddmmyyyy(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Visible version marker (helps confirm GitHub/Vercel deploy is the right build)
const BUILD_TAG = "2025-12-28 local-sync-L1";

export default function HomePage() {
  const [sessionReady, setSessionReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  const [rows, setRows] = useState<PlanRow[]>([]);
  const today = new Date();

  const loadToday = async () => {
    setMsg("");
    const { data, error } = await supabase
      .from("v_today_plan_app")
      .select("*")
      .order("sequence_no", { ascending: true });

    if (error) setMsg(error.message);
    else setRows((data as PlanRow[]) ?? []);
  };

  const signInMagicLink = async () => {
    setMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }, // <-- THIS drives localhost redirect
    });
    setMsg(error ? error.message : "Magic link sent. Check your email.");
  };

  const signOut = async () => {
    setMsg("");
    await supabase.auth.signOut();
    setRows([]);
    setIsAuthed(false);
  };

  const generatePlan = async () => {
    setMsg("");
    const startDate = isoDate(new Date());
    const days = 5;

    const { error } = await supabase.rpc("generate_plan", {
      p_start_date: startDate,
      p_days: days,
    });

    setMsg(error ? error.message : "Plan generated.");
    if (!error) await loadToday();
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthed(!!data.session);
      setSessionReady(true);
      if (data.session) loadToday();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setIsAuthed(!!s);
      setSessionReady(true);
      if (s) loadToday();
      else setRows([]);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  if (!sessionReady)
    return <main style={{ padding: 24, fontFamily: "system-ui" }}>Loading…</main>;

  if (!isAuthed) {
    return (
      <main style={{ maxWidth: 520, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
        <h2 style={{ marginTop: 0 }}>Gym PWA</h2>

        <div style={{ opacity: 0.55, fontSize: 12, marginTop: -6, marginBottom: 12 }}>
          build: {BUILD_TAG}
        </div>

        <p>Login (magic link)</p>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            style={{ flex: 1, padding: 10 }}
          />
          <button onClick={signInMagicLink} style={{ padding: 10 }}>
            Send link
          </button>
        </div>

        {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 980, margin: "24px auto", padding: 16, fontFamily: "system-ui" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Today ({ddmmyyyy(today)})</h2>
          <div style={{ opacity: 0.55, fontSize: 12 }}>build: {BUILD_TAG}</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={generatePlan} style={{ padding: 10 }}>
            Generate / Regenerate
          </button>
          <button onClick={loadToday} style={{ padding: 10 }}>
            Refresh
          </button>
          <button onClick={signOut} style={{ padding: 10 }}>
            Sign out
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <a href="/log">Go to Log Session →</a>
      </div>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}

      <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>Exercise</th>
            <th style={th}>Target</th>
            <th style={th}>Suggested (kg)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const target =
              r.exercise_type === 2
                ? `${Math.round((r.target_duration_sec ?? 300) / 60)} min`
                : `${r.target_sets ?? 3} x ${r.target_reps ?? 10}`;

            const suggested = r.exercise_type === 1 ? (r.suggested_load_kg ?? "") : "";

            return (
              <tr key={`${r.plan_date}-${r.sequence_no}`}>
                <td style={td}>{r.sequence_no}</td>
                <td style={td}>{r.exercise_name}</td>
                <td style={td}>{target}</td>
                <td style={td}>{suggested}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td style={td} colSpan={4}>
                No plan rows returned.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #ddd",
  padding: 10,
};

const td: React.CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: 10,
  verticalAlign: "top",
};

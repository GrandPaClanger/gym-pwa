"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type PlanRow = {
  person_id: number;
  plan_date: string;
  sequence_no: number;
  exercise_name: string;
  exercise_type: number; // 1 strength, 2 cardio
  target_sets: number | null;
  target_reps: number | null;
  target_duration_sec: number | null;
  suggested_load_kg: number | null;
};

export default function Page() {
  const [email, setEmail] = useState("");
  const [session, setSession] = useState<any>(null);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadToday = async () => {
    setMsg("");
    const { data, error } = await supabase
      .from("v_today_plan_app")
      .select("*")
      .order("sequence_no", { ascending: true });

    if (error) setMsg(error.message);
    else setRows((data as PlanRow[]) ?? []);
  };

  const generateToday = async () => {
    setMsg("");
    const { error } = await supabase.rpc("generate_today_plan", { p_cooldown_days: 10 });
    if (error) setMsg(error.message);
    else await loadToday();
  };

  const sendMagicLink = async () => {
    setMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/` },
    });
    setMsg(error ? error.message : "Magic link sent. Check your email.");
  };

  useEffect(() => {
    if (session) loadToday();
  }, [session]);

  const todayLabel = useMemo(() => new Date().toLocaleDateString(), []);

  if (!session) {
    return (
      <main style={{ maxWidth: 520, margin: "24px auto", padding: 16, fontFamily: "system-ui" }}>
        <h2>Gym PWA</h2>
        <p>Login (magic link)</p>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{ width: "100%", padding: 10, fontSize: 16 }}
        />
        <button onClick={sendMagicLink} style={{ marginTop: 12, padding: 10, width: "100%" }}>
          Send link
        </button>
        {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "24px auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Today ({todayLabel})</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={generateToday} style={{ padding: 10 }}>Generate / Regenerate</button>
          <button onClick={loadToday} style={{ padding: 10 }}>Refresh</button>
          <button onClick={() => supabase.auth.signOut()} style={{ padding: 10 }}>Sign out</button>
        </div>
      </div>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}

      <div style={{ marginTop: 16 }}>
        <a href="/log">Go to Log Session →</a>
      </div>

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
            const suggested = r.exercise_type === 2 ? "" : (r.suggested_load_kg ?? "").toString();
            return (
              <tr key={`${r.plan_date}-${r.sequence_no}`}>
                <td style={td}>{r.sequence_no}</td>
                <td style={td}>{r.exercise_name}</td>
                <td style={td}>{target}</td>
                <td style={td}>{suggested}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}

const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #ddd", padding: 10 };
const td: React.CSSProperties = { borderBottom: "1px solid #eee", padding: 10, verticalAlign: "top" };

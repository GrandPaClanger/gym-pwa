"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type TodayRow = {
  plan_date: string;
  sequence_no: number;
  exercise_name: string;
  exercise_type: number; // 1 strength, 2 cardio
  target_sets: number | null;
  target_reps: number | null;
  target_duration_sec: number | null;
  suggested_load_kg: number | null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function minsFromSec(sec: number | null) {
  if (!sec || sec <= 0) return 0;
  return Math.round(sec / 60);
}

function targetText(r: TodayRow) {
  if (r.exercise_type === 2) {
    const m = minsFromSec(r.target_duration_sec);
    return m > 0 ? `${m} min` : "";
  }
  const sets = r.target_sets ?? 3;
  const reps = r.target_reps ?? 10;
  return `${sets}×${reps}`;
}

export default function HomePage() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const [rows, setRows] = useState<TodayRow[]>([]);

  const checkIsAdmin = async () => {
    const { data, error } = await supabase.rpc("is_admin_user");
    setIsAdmin(!error && !!data);
  };

  const loadToday = async () => {
    setMsg("");
    setLoading(true);

    try {
      // IMPORTANT: use the same view as /log so behaviour matches.
      const { data, error } = await supabase
        .from("v_plan_today_edit")
        .select(
          "plan_date, sequence_no, exercise_name, exercise_type, target_sets, target_reps, target_duration_sec, suggested_load_kg"
        )
        .eq("plan_date", todayIso())
        .order("sequence_no", { ascending: true });

      if (error) {
        setRows([]);
        setMsg(error.message);
        return;
      }

      setRows(((data as any[]) ?? []) as TodayRow[]);
    } finally {
      setLoading(false);
    }
  };

  const generateRegenerate = async () => {
    setMsg("");

    const { error } = await supabase.rpc("generate_plan_days", {
      p_start_date: todayIso(),
      p_days: 1,
      p_cooldown_days: 10,
    });

    if (error) return setMsg(error.message);

    await loadToday();
    setMsg("Plan generated.");
  };

  const generateEmptyPlan = async () => {
    setMsg("");

    const { error } = await supabase.rpc("generate_empty_plan", {
      p_plan_date: todayIso(),
    });

    if (error) return setMsg(error.message);

    await loadToday();
    setMsg("Empty plan generated.");
  };

  const refresh = async () => {
    await loadToday();
    setMsg("");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setIsAdmin(false);
    setRows([]);
    setMsg("");
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const ok = !!data.session;
      setIsAuthed(ok);

      if (ok) {
        await checkIsAdmin();
        await loadToday();
      } else {
        setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const ok = !!session;
      setIsAuthed(ok);

      if (ok) {
        await checkIsAdmin();
        await loadToday();
      } else {
        setIsAdmin(false);
        setRows([]);
        setMsg("");
      }
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const th: React.CSSProperties = { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #333" };
  const td: React.CSSProperties = { padding: "10px 8px", borderBottom: "1px solid #222", verticalAlign: "top" };

  const titleDate = useMemo(() => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }, []);

  return (
    <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8, textAlign: "center" }}>Today ({titleDate})</h1>

      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ marginTop: 10, display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/log">Go to Log Session →</a>
          {isAdmin && <a href="/admin/exercises">Admin: Exercise Maintenance →</a>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end", marginBottom: 14 }}>
        <button onClick={generateRegenerate} style={{ padding: "10px 14px" }} disabled={!isAuthed}>
          Generate / Regenerate
        </button>
        <button onClick={generateEmptyPlan} style={{ padding: "10px 14px" }} disabled={!isAuthed}>
          Generate Empty Plan
        </button>
        <button onClick={refresh} style={{ padding: "10px 14px" }} disabled={!isAuthed}>
          Refresh
        </button>
        <button onClick={signOut} style={{ padding: "10px 14px" }} disabled={!isAuthed}>
          Sign out
        </button>
      </div>

      {msg && <div style={{ marginBottom: 12, textAlign: "center" }}>{msg}</div>}
      {loading && <div style={{ marginBottom: 12, textAlign: "center" }}>Loading…</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>#</th>
              <th style={th}>Exercise</th>
              <th style={th}>Target</th>
              <th style={th}>Suggested (kg)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.plan_date}-${r.sequence_no}`}>
                <td style={td}>{r.sequence_no}</td>
                <td style={td}>{r.exercise_name}</td>
                <td style={td}>{targetText(r)}</td>
                <td style={td}>{r.suggested_load_kg ?? ""}</td>
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td style={td} colSpan={4}>
                  No plan rows for today.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

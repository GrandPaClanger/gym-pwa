"use client";

import { useEffect, useMemo, useState } from "react";
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

type StrengthSet = { reps: number; load_kg: number | null };
type RowPayload =
  | { sequence_no: number; name: string; duration_min?: number; duration_sec?: number }
  | { sequence_no: number; name: string; sets: StrengthSet[] };

export default function LogPage() {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [durationMin, setDurationMin] = useState<number>(60);
  const [msg, setMsg] = useState<string>("");

  const loadToday = async () => {
    setMsg("");
    const { data, error } = await supabase
      .from("v_today_plan_app")
      .select("*")
      .order("sequence_no", { ascending: true });

    if (error) setMsg(error.message);
    else setRows((data as PlanRow[]) ?? []);
  };

  useEffect(() => {
    loadToday();
  }, []);

  const [loads, setLoads] = useState<Record<string, number | "">>({});
  const [reps, setReps] = useState<Record<string, number | "">>({});

  useEffect(() => {
    const nextLoads: any = {};
    const nextReps: any = {};
    for (const r of rows) {
      if (r.exercise_type === 1) {
        nextLoads[r.exercise_name] = r.suggested_load_kg ?? "";
        nextReps[r.exercise_name] = r.target_reps ?? 10;
      }
    }
    setLoads(nextLoads);
    setReps(nextReps);
  }, [rows]);

  const payload: RowPayload[] = useMemo(() => {
    return rows.map((r) => {
      if (r.exercise_type === 2) {
        const sec = r.target_duration_sec ?? 300;
        return { sequence_no: r.sequence_no, name: r.exercise_name, duration_sec: sec };
      } else {
        const s = r.target_sets ?? 3;
        const rep = Number(reps[r.exercise_name] === "" ? (r.target_reps ?? 10) : reps[r.exercise_name]);
        const load = loads[r.exercise_name] === "" ? null : Number(loads[r.exercise_name]);
        return {
          sequence_no: r.sequence_no,
          name: r.exercise_name,
          sets: Array.from({ length: s }, () => ({ reps: rep, load_kg: load })),
        };
      }
    });
  }, [rows, loads, reps]);

  const save = async () => {
    setMsg("");
    const { error } = await supabase.rpc("log_session_json", {
      p_session_start: new Date().toISOString(),
      p_duration_min: durationMin,
      p_rows: payload,
    });
    setMsg(error ? error.message : "Saved.");
  };

  return (
    <main style={{ maxWidth: 900, margin: "24px auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Log Session</h2>
        <a href="/">← Back</a>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
        <label>
          Duration (min):{" "}
          <input
            type="number"
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
            style={{ width: 80, padding: 6 }}
          />
        </label>
        <button onClick={save} style={{ padding: 10 }}>Save session</button>
        <button onClick={loadToday} style={{ padding: 10 }}>Refresh plan</button>
      </div>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}

      <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>Exercise</th>
            <th style={th}>Type</th>
            <th style={th}>Edit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.plan_date}-${r.sequence_no}`}>
              <td style={td}>{r.sequence_no}</td>
              <td style={td}>{r.exercise_name}</td>
              <td style={td}>{r.exercise_type === 2 ? "Cardio" : "Strength"}</td>
              <td style={td}>
                {r.exercise_type === 2 ? (
                  <span>{Math.round((r.target_duration_sec ?? 300) / 60)} min</span>
                ) : (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <label>
                      Reps:{" "}
                      <input
                        type="number"
                        value={reps[r.exercise_name] ?? ""}
                        onChange={(e) =>
                          setReps((prev) => ({
                            ...prev,
                            [r.exercise_name]: e.target.value === "" ? "" : Number(e.target.value),
                          }))
                        }
                        style={{ width: 80, padding: 6 }}
                      />
                    </label>
                    <label>
                      Load (kg):{" "}
                      <input
                        type="number"
                        value={loads[r.exercise_name] ?? ""}
                        onChange={(e) =>
                          setLoads((prev) => ({
                            ...prev,
                            [r.exercise_name]: e.target.value === "" ? "" : Number(e.target.value),
                          }))
                        }
                        style={{ width: 110, padding: 6 }}
                      />
                    </label>
                    <span>Sets: {r.target_sets ?? 3}</span>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #ddd", padding: 10 };
const td: React.CSSProperties = { borderBottom: "1px solid #eee", padding: 10, verticalAlign: "top" };

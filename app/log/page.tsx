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

type Exercise = {
  exercise_id: number;
  canonical_name: string;
  exercise_type: number; // 1 strength, 2 cardio
};

type StrengthSet = { reps: number; load_kg: number | null };
type RowPayload =
  | { sequence_no: number; name: string; duration_sec: number }
  | { sequence_no: number; name: string; sets: StrengthSet[] };

const rowKey = (r: PlanRow) => `${r.plan_date}-${r.sequence_no}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function LogPage() {
  const [sessionReady, setSessionReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [email, setEmail] = useState("");

  const [rows, setRows] = useState<PlanRow[]>([]);
  const [durationMin, setDurationMin] = useState<number>(60);
  const [msg, setMsg] = useState<string>("");

  const [exerciseList, setExerciseList] = useState<Exercise[]>([]);
  const [addExerciseId, setAddExerciseId] = useState<number | "">("");

  const [loads, setLoads] = useState<Record<string, number | "">>({});
  const [reps, setReps] = useState<Record<string, number | "">>({});

  const loadToday = async () => {
    setMsg("");
    const { data, error } = await supabase
      .from("v_today_plan_app")
      .select("*")
      .order("sequence_no", { ascending: true });

    if (error) {
      setMsg(error.message);
      setRows([]);
      return;
    }
    setRows((data as PlanRow[]) ?? []);
  };

  const loadExercises = async () => {
    const { data, error } = await supabase
      .from("exercise")
      .select("exercise_id, canonical_name, exercise_type")
      .order("canonical_name", { ascending: true });

    if (error) setMsg(error.message);
    else setExerciseList((data as Exercise[]) ?? []);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const ok = !!data.session;
      setIsAuthed(ok);
      setSessionReady(true);
      if (ok) {
        loadToday();
        loadExercises();
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      const ok = !!s;
      setIsAuthed(ok);
      setSessionReady(true);
      if (ok) {
        loadToday();
        loadExercises();
      } else {
        setRows([]);
      }
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const nextLoads: Record<string, number | ""> = {};
    const nextReps: Record<string, number | ""> = {};
    for (const r of rows) {
      if (r.exercise_type === 1) {
        const k = rowKey(r);
        nextLoads[k] = r.suggested_load_kg ?? "";
        nextReps[k] = r.target_reps ?? 10;
      }
    }
    setLoads(nextLoads);
    setReps(nextReps);
  }, [rows]);

  const payload: RowPayload[] = useMemo(() => {
    return rows.map((r) => {
      if (r.exercise_type === 2) {
        return {
          sequence_no: r.sequence_no,
          name: r.exercise_name,
          duration_sec: r.target_duration_sec ?? 300,
        };
      }

      const k = rowKey(r);
      const s = r.target_sets ?? 3;
      const rep = reps[k] === "" || reps[k] == null ? (r.target_reps ?? 10) : Number(reps[k]);
      const load = loads[k] === "" || loads[k] == null ? null : Number(loads[k]);

      return {
        sequence_no: r.sequence_no,
        name: r.exercise_name,
        sets: Array.from({ length: s }, () => ({ reps: rep, load_kg: load })),
      };
    });
  }, [rows, loads, reps]);

  const signInMagicLink = async () => {
    setMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setMsg(error ? error.message : "Magic link sent. Check your email.");
  };

  const getTodayPlanId = async (): Promise<number | null> => {
    const { data, error } = await supabase
      .from("workout_plan")
      .select("plan_id")
      .eq("plan_date", todayIso())
      .order("plan_id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setMsg(error.message);
      return null;
    }
    if (!data?.plan_id) {
      setMsg("No plan for today. Generate it on the home page first.");
      return null;
    }
    return data.plan_id as number;
  };

  const replaceExercise = async (sequence_no: number, new_exercise_id: number) => {
    setMsg("");
    const planId = await getTodayPlanId();
    if (!planId) return;

    const { error } = await supabase
      .from("workout_plan_item")
      .update({ exercise_id: new_exercise_id })
      .eq("plan_id", planId)
      .eq("sequence_no", sequence_no);

    if (error) setMsg(error.message);
    else await loadToday();
  };

  // NEW: remove this item from today's plan (does not delete the exercise)
  const removeExercise = async (sequence_no: number) => {
    setMsg("");
    const planId = await getTodayPlanId();
    if (!planId) return;

    const ok = confirm("Remove this exercise from today’s plan?");
    if (!ok) return;

    const { error } = await supabase
      .from("workout_plan_item")
      .delete()
      .eq("plan_id", planId)
      .eq("sequence_no", sequence_no);

    if (error) setMsg(error.message);
    else await loadToday();
  };

  const addExercise = async () => {
    if (addExerciseId === "") return;
    setMsg("");

    const planId = await getTodayPlanId();
    if (!planId) return;

    const { data: lastItem, error: seqErr } = await supabase
      .from("workout_plan_item")
      .select("sequence_no")
      .eq("plan_id", planId)
      .order("sequence_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (seqErr) return setMsg(seqErr.message);

    const nextSeq = (lastItem?.sequence_no ?? 0) + 10;

    const ex = exerciseList.find((e) => e.exercise_id === addExerciseId);
    if (!ex) return setMsg("Exercise not found in list.");

    const isCardio = ex.exercise_type === 2;

    const { error: insErr } = await supabase.from("workout_plan_item").insert({
      plan_id: planId,
      sequence_no: nextSeq,
      exercise_id: addExerciseId,
      target_sets: isCardio ? 1 : 3,
      target_reps: isCardio ? 1 : 10,
      target_duration_sec: isCardio ? 300 : null,
      target_load_kg: null,
    });

    if (insErr) setMsg(insErr.message);
    else {
      setAddExerciseId("");
      await loadToday();
    }
  };

  const save = async () => {
    setMsg("");
    const { error } = await supabase.rpc("log_session_json", {
      p_session_start: new Date().toISOString(),
      p_duration_min: durationMin,
      p_rows: payload,
    });
    setMsg(error ? error.message : "Saved.");
  };

  if (!sessionReady) return <main style={{ padding: 24, fontFamily: "system-ui" }}>Loading…</main>;

  if (!isAuthed) {
    return (
      <main style={{ maxWidth: 520, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
        <h2 style={{ marginTop: 0 }}>Gym PWA</h2>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Log Session</h2>
        <a href="/">← Back</a>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Duration (min):{" "}
          <input
            type="number"
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
            style={{ width: 90, padding: 6 }}
          />
        </label>
        <button onClick={save} style={{ padding: 10 }}>
          Save session
        </button>
        <button onClick={loadToday} style={{ padding: 10 }}>
          Refresh plan
        </button>
        <span style={{ opacity: 0.7 }}>Rows loaded: {rows.length}</span>
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>Edit today’s plan</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={addExerciseId}
            onChange={(e) => setAddExerciseId(e.target.value === "" ? "" : Number(e.target.value))}
            style={{ padding: 8, minWidth: 280 }}
          >
            <option value="">Add an exercise…</option>
            {exerciseList.map((ex) => (
              <option key={ex.exercise_id} value={ex.exercise_id}>
                {ex.canonical_name}
              </option>
            ))}
          </select>
          <button onClick={addExercise} style={{ padding: 10 }}>
            Add
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
          Swap uses the dropdown beside each row. Add appends to the end. Remove deletes from today’s plan.
        </div>
      </div>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}

      <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>Exercise</th>
            <th style={th}>Type</th>
            <th style={th}>Edit / Swap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k}>
                <td style={td}>{r.sequence_no}</td>
                <td style={td}>{r.exercise_name}</td>
                <td style={td}>{r.exercise_type === 2 ? "Cardio" : "Strength"}</td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (v) replaceExercise(r.sequence_no, v);
                      }}
                      style={{ padding: 6, minWidth: 240 }}
                      title="Swap exercise"
                    >
                      <option value="">Swap exercise…</option>
                      {exerciseList.map((ex) => (
                        <option key={ex.exercise_id} value={ex.exercise_id}>
                          {ex.canonical_name}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => removeExercise(r.sequence_no)}
                      style={{ padding: "6px 10px" }}
                      title="Remove from today’s plan"
                    >
                      Remove
                    </button>

                    {r.exercise_type === 2 ? (
                      <span>{Math.round((r.target_duration_sec ?? 300) / 60)} min</span>
                    ) : (
                      <>
                        <label>
                          Reps:{" "}
                          <input
                            type="number"
                            value={reps[k] ?? ""}
                            onChange={(e) =>
                              setReps((prev) => ({
                                ...prev,
                                [k]: e.target.value === "" ? "" : Number(e.target.value),
                              }))
                            }
                            style={{ width: 80, padding: 6 }}
                          />
                        </label>

                        <label>
                          Load (kg):{" "}
                          <input
                            type="number"
                            value={loads[k] ?? ""}
                            onChange={(e) =>
                              setLoads((prev) => ({
                                ...prev,
                                [k]: e.target.value === "" ? "" : Number(e.target.value),
                              }))
                            }
                            style={{ width: 110, padding: 6 }}
                          />
                        </label>

                        <span>Sets: {r.target_sets ?? 3}</span>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}

          {rows.length === 0 && (
            <tr>
              <td style={td} colSpan={4}>
                No plan rows returned (try Refresh plan).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}

const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #ddd", padding: 10 };
const td: React.CSSProperties = { borderBottom: "1px solid #eee", padding: 10, verticalAlign: "top" };

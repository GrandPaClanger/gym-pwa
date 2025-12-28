"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  plan_item_id: number;
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
  const [isAuthed, setIsAuthed] = useState(false);
  const [email, setEmail] = useState("");

  const [rows, setRows] = useState<PlanRow[]>([]);
  const [durationMin, setDurationMin] = useState<number>(60);
  const [msg, setMsg] = useState<string>("");

  const [exerciseList, setExerciseList] = useState<Exercise[]>([]);
  const [addExerciseId, setAddExerciseId] = useState<number | "">("");

  const [loads, setLoads] = useState<Record<string, number | "">>({});
  const [reps, setReps] = useState<Record<string, number | "">>({});
  const [sets, setSets] = useState<Record<string, number | "">>({});

  // ✅ Stable session start (does NOT change on every save)
  const [sessionStart, setSessionStart] = useState<string>("");

  // debounced timers per plan item (keyed by planId+sequence)
  const autosaveTimers = useRef<Record<string, any>>({});

  const loadExerciseList = async () => {
    const { data, error } = await supabase
      .from("exercise")
      .select("exercise_id, canonical_name, exercise_type")
      .order("canonical_name");

    if (error) {
      setMsg(error.message);
      return;
    }
    setExerciseList((data ?? []) as Exercise[]);
  };

  const getTodayPlanId = async (): Promise<number | null> => {
    const planDate = todayIso();
    const { data, error } = await supabase
      .from("workout_plan")
      .select("plan_id")
      .eq("plan_date", planDate)
      .maybeSingle();

    if (error) {
      setMsg(error.message);
      return null;
    }
    return data?.plan_id ?? null;
  };

  const loadToday = async () => {
    setMsg("");
    const planDate = todayIso();

    const { data, error } = await supabase
      .from("v_plan_today_edit")
      .select("*")
      .eq("plan_date", planDate)
      .order("sequence_no");

    if (error) {
      setMsg(error.message);
      setRows([]);
      return;
    }

    setRows((data ?? []) as PlanRow[]);
  };

  const refreshPlan = async () => {
    setMsg("");
    const planDate = todayIso();

    const { error } = await supabase.rpc("generate_plan", {
      p_plan_date: planDate,
      p_cooldown_days: 10,
    });

    if (error) {
      setMsg(error.message);
      return;
    }

    await loadToday();
  };

  // Auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthed(!!data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsAuthed(!!session);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load plan + exercises when authed
  useEffect(() => {
    if (!isAuthed) return;
    void loadExerciseList();
    void loadToday();
  }, [isAuthed]);

  // Stable session start stored in localStorage
  useEffect(() => {
    if (!isAuthed) return;

    const key = `gym.session_start.${todayIso()}`;
    const existing = window.localStorage.getItem(key);
    if (existing) {
      setSessionStart(existing);
      return;
    }

    const fresh = new Date().toISOString();
    window.localStorage.setItem(key, fresh);
    setSessionStart(fresh);
  }, [isAuthed]);

  const newSession = () => {
    const key = `gym.session_start.${todayIso()}`;
    const fresh = new Date().toISOString();
    window.localStorage.setItem(key, fresh);
    setSessionStart(fresh);
    setMsg("New session started.");
  };

  // Debounced autosave to workout_plan_item (targets only)
  const queueAutosave = async (sequence_no: number, patch: Record<string, any>) => {
    const planId = await getTodayPlanId();
    if (!planId) return;

    const k = `${planId}-${sequence_no}`;

    if (autosaveTimers.current[k]) clearTimeout(autosaveTimers.current[k]);

    autosaveTimers.current[k] = setTimeout(async () => {
      const { error } = await supabase
        .from("workout_plan_item")
        .update(patch)
        .eq("plan_id", planId)
        .eq("sequence_no", sequence_no);

      if (error) setMsg(error.message);
    }, 500);
  };

  // When plan rows load, prefill loads/reps maps WITHOUT overwriting existing edits
  useEffect(() => {
    setLoads((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.exercise_type !== 1) continue;
        const k = rowKey(r);
        if (next[k] === undefined) next[k] = r.suggested_load_kg ?? "";
      }
      return next;
    });

    setReps((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.exercise_type !== 1) continue;
        const k = rowKey(r);
        if (next[k] === undefined) next[k] = r.target_reps ?? 10;
      }
      return next;
    });

    setSets((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.exercise_type !== 1) continue;
        const k = rowKey(r);
        if (next[k] === undefined) next[k] = r.target_sets ?? 3;
      }
      return next;
    });
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
      const s = sets[k] === "" || sets[k] == null ? (r.target_sets ?? 3) : Number(sets[k]);
      const rep = reps[k] === "" || reps[k] == null ? r.target_reps ?? 10 : Number(reps[k]);
      const load = loads[k] === "" || loads[k] == null ? null : Number(loads[k]);

      return {
        sequence_no: r.sequence_no,
        name: r.exercise_name,
        sets: Array.from({ length: s }, () => ({ reps: rep, load_kg: load })),
      };
    });
  }, [rows, loads, reps, sets]);

  const signInMagicLink = async () => {
    setMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setMsg(error ? error.message : "Magic link sent. Check your email.");
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

  const removeExercise = async (sequence_no: number) => {
    setMsg("");
    const planId = await getTodayPlanId();
    if (!planId) return;

    const { error } = await supabase
      .from("workout_plan_item")
      .delete()
      .eq("plan_id", planId)
      .eq("sequence_no", sequence_no);

    if (error) setMsg(error.message);
    else await loadToday();
  };

  const addExercise = async () => {
    setMsg("");
    if (addExerciseId === "") return;

    const planId = await getTodayPlanId();
    if (!planId) return;

    // append after max sequence_no
    const maxSeq = rows.reduce((m, r) => Math.max(m, r.sequence_no), 0);
    const seq = maxSeq + 1;

    const exercise = exerciseList.find((e) => e.exercise_id === addExerciseId);
    if (!exercise) return;

    const insertRow: any = {
      plan_id: planId,
      sequence_no: seq,
      exercise_id: exercise.exercise_id,
      target_reps: exercise.exercise_type === 1 ? 10 : null,
      target_sets: exercise.exercise_type === 1 ? 3 : null,
      target_duration_sec: exercise.exercise_type === 2 ? 2400 : null,
      target_load_kg: null,
    };

    const { error } = await supabase.from("workout_plan_item").insert(insertRow);
    if (error) setMsg(error.message);
    else {
      setAddExerciseId("");
      await loadToday();
    }
  };

  const saveSession = async () => {
    setMsg("");
    if (!sessionStart) {
      setMsg("Session start missing (try New session).");
      return;
    }

    const { error } = await supabase.rpc("log_session_json", {
      p_plan_date: todayIso(),
      p_session_start: sessionStart,
      p_duration_min: durationMin,
      p_rows: payload,
    });

    setMsg(error ? error.message : "Session saved.");
  };

  return (
    <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 6 }}>Log Session</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Plan date: <b>{todayIso()}</b> • Session start: <b>{sessionStart ? sessionStart : "—"}</b>
      </p>

      {!isAuthed && (
        <div style={{ border: "1px solid #ddd", padding: 14, borderRadius: 8, marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>Sign in</h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              style={{ width: 260, padding: 10 }}
            />
            <button onClick={signInMagicLink} style={{ padding: "10px 14px" }}>
              Send magic link
            </button>
          </div>
        </div>
      )}

      {isAuthed && (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <button onClick={refreshPlan} style={{ padding: "10px 14px" }}>
              Refresh plan
            </button>
            <button onClick={loadToday} style={{ padding: "10px 14px" }}>
              Reload rows
            </button>
            <button onClick={newSession} style={{ padding: "10px 14px" }}>
              New session
            </button>

            <label style={{ marginLeft: 10 }}>
              Duration (min):{" "}
              <input
                type="number"
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                style={{ width: 90, padding: 6 }}
              />
            </label>

            <button onClick={saveSession} style={{ padding: "10px 14px" }}>
              Save session
            </button>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <select
              value={addExerciseId}
              onChange={(e) => setAddExerciseId(e.target.value === "" ? "" : Number(e.target.value))}
              style={{ padding: 10, minWidth: 320 }}
            >
              <option value="">Add exercise…</option>
              {exerciseList.map((e) => (
                <option key={e.exercise_id} value={e.exercise_id}>
                  {e.canonical_name}
                </option>
              ))}
            </select>
            <button onClick={addExercise} style={{ padding: "10px 14px" }}>
              Add
            </button>
          </div>

          {msg && <div style={{ marginBottom: 14, color: "#b00020" }}>{msg}</div>}

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>Exercise</th>
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
                    <td style={td}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            void replaceExercise(r.sequence_no, Number(v));
                          }}
                          style={{ padding: 10, minWidth: 260 }}
                        >
                          <option value="">Swap…</option>
                          {exerciseList.map((e) => (
                            <option key={e.exercise_id} value={e.exercise_id}>
                              {e.canonical_name}
                            </option>
                          ))}
                        </select>

                        <button onClick={() => void removeExercise(r.sequence_no)} style={{ padding: "10px 14px" }}>
                          Remove
                        </button>

                        {r.exercise_type === 2 ? (
                          <span style={{ color: "#555" }}>
                            Duration (sec): {r.target_duration_sec ?? 300}
                          </span>
                        ) : (
                          <>
                            <label>
                              Reps:{" "}
                              <input
                                type="number"
                                value={reps[k] ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value === "" ? "" : Number(e.target.value);
                                  setReps((prev) => ({ ...prev, [k]: v }));
                                  if (v !== "") queueAutosave(r.sequence_no, { target_reps: v });
                                }}
                                style={{ width: 80, padding: 6 }}
                              />
                            </label>

                            <label>
                              Load (kg):{" "}
                              <input
                                type="number"
                                value={loads[k] ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value === "" ? "" : Number(e.target.value);
                                  setLoads((prev) => ({ ...prev, [k]: v }));
                                  if (v !== "") queueAutosave(r.sequence_no, { target_load_kg: v });
                                }}
                                style={{ width: 110, padding: 6 }}
                              />
                            </label>

                            <label>
                              Sets:{" "}
                              <input
                                type="number"
                                min={1}
                                max={6}
                                value={sets[k] ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value === "" ? "" : Number(e.target.value);
                                  setSets((prev) => ({ ...prev, [k]: v }));
                                  if (v !== "") queueAutosave(r.sequence_no, { target_sets: v });
                                }}
                                style={{ width: 70, padding: 6 }}
                              />
                            </label>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 && (
                <tr>
                  <td style={td} colSpan={3}>
                    No plan rows returned (try Refresh plan).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #ddd", padding: 10 };
const td: React.CSSProperties = { borderBottom: "1px solid #eee", padding: 10, verticalAlign: "top" };

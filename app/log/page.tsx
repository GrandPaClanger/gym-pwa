"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type PlanRow = {
  plan_date: string;
  sequence_no: number;
  plan_item_id: number;
  exercise_id: number | null;
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

const REP_MIN = 8;
const REP_MAX = 20;
const ADD_EXERCISE_MAX_OPTIONS = 500;

const todayIso = () => new Date().toISOString().slice(0, 10);
const rowKey = (r: Pick<PlanRow, "plan_date" | "sequence_no">) => `${r.plan_date}-${r.sequence_no}`;
const slotKey = (plan_date: string, sequence_no: number) => `${plan_date}-${sequence_no}`;

const isValidReps = (n: number) => Number.isFinite(n) && n >= REP_MIN && n <= REP_MAX;

export default function LogPage() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [email, setEmail] = useState("");

  const [rows, setRows] = useState<PlanRow[]>([]);
  const [exerciseList, setExerciseList] = useState<Exercise[]>([]);

  const [durationMin, setDurationMin] = useState<number>(60);
  const [msg, setMsg] = useState<string>("");

  // Stable session start stored in localStorage
  const [sessionStart, setSessionStart] = useState<string>("");

  // Local edits keyed by plan_date+sequence
  const [loads, setLoads] = useState<Record<string, number | "">>({});
  const [reps, setReps] = useState<Record<string, number | "">>({});
  const [sets, setSets] = useState<Record<string, number | "">>({});
  const [durationsMin, setDurationsMin] = useState<Record<string, number | "">>({});

  // Swap select (we keep this as a placeholder selector, not showing current exercise)
  const [swapPick, setSwapPick] = useState<Record<string, number | "">>({});

  // Predictive filter for Add exercise…
  const [addExerciseQuery, setAddExerciseQuery] = useState<string>("");
  const [addExerciseId, setAddExerciseId] = useState<number | "">("");

  // debounced timers per slot
  const autosaveTimers = useRef<Record<string, any>>({});

  const signInMagicLink = async () => {
    setMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setMsg(error ? error.message : "Magic link sent. Check your email.");
  };

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

  const ensureSessionStart = () => {
    const key = `gym.session_start.${todayIso()}`;
    const existing = window.localStorage.getItem(key);
    if (existing) {
      setSessionStart(existing);
      return existing;
    }
    const fresh = new Date().toISOString();
    window.localStorage.setItem(key, fresh);
    setSessionStart(fresh);
    return fresh;
  };

  const newSession = () => {
    const key = `gym.session_start.${todayIso()}`;
    const fresh = new Date().toISOString();
    window.localStorage.setItem(key, fresh);
    setSessionStart(fresh);
    setMsg("");
  };

  const queueAutosave = (sequence_no: number, patch: Partial<{ target_sets: number | null; target_reps: number | null; target_load_kg: number | null; target_duration_sec: number | null }>) => {
    const planDate = todayIso();
    const k = slotKey(planDate, sequence_no);

    if (autosaveTimers.current[k]) clearTimeout(autosaveTimers.current[k]);
    autosaveTimers.current[k] = setTimeout(async () => {
      const planId = await getTodayPlanId();
      if (!planId) return;

      const { error } = await supabase
        .from("workout_plan_item")
        .update(patch)
        .eq("plan_id", planId)
        .eq("sequence_no", sequence_no);

      if (error) setMsg(error.message);
    }, 500);
  };

  const replaceExercise = async (sequence_no: number, new_exercise_id: number) => {
    setMsg("");
    const planId = await getTodayPlanId();
    if (!planId) return;

    const planDate = todayIso();
    const k = slotKey(planDate, sequence_no);
    const newExercise = exerciseList.find((e) => e.exercise_id === new_exercise_id);

    // 1) swap in DB
    const { error } = await supabase
      .from("workout_plan_item")
      .update({ exercise_id: new_exercise_id })
      .eq("plan_id", planId)
      .eq("sequence_no", sequence_no);

    if (error) {
      setMsg(error.message);
      return;
    }

    // 2) clear local edits for this slot (otherwise old values stick)
    setLoads((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });
    setReps((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });
    setSets((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });
    setDurationsMin((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });

    // reset swap selector back to placeholder
    setSwapPick((p) => ({ ...p, [k]: "" }));

    // 3) refresh rows so exercise name/type updates
    await loadToday();

    // 4) apply sensible defaults for the new exercise
    if (newExercise?.exercise_type === 2) {
      // cardio defaults (keep NOT NULL happy)
      queueAutosave(sequence_no, {
        target_sets: 0,
        target_reps: 0,
        target_load_kg: null,
        target_duration_sec: 480,
      });
      setDurationsMin((p) => ({ ...p, [k]: 8 }));
      return;
    }

    // strength: last logged values
    const { data, error: err2 } = await supabase
      .from("v_last_exercise_values")
      .select("last_sets,last_reps,last_load_kg")
      .eq("exercise_id", new_exercise_id)
      .maybeSingle();

    if (err2) {
      setMsg(err2.message);
      return;
    }

    const nextSets = (data?.last_sets ?? 3) as number;
    const nextReps = (data?.last_reps ?? 10) as number;
    const nextLoad = (data?.last_load_kg ?? null) as number | null;

    setSets((p) => ({ ...p, [k]: nextSets }));
    setReps((p) => ({ ...p, [k]: nextReps }));
    setLoads((p) => ({ ...p, [k]: nextLoad ?? "" }));

    queueAutosave(sequence_no, {
      target_sets: nextSets,
      target_reps: nextReps,
      target_load_kg: nextLoad,
    });
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

    const e = exerciseList.find((x) => x.exercise_id === addExerciseId);
    if (!e) {
      setMsg("Exercise not found in list.");
      return;
    }

    const nextSeq = rows.length ? Math.max(...rows.map((r) => r.sequence_no)) + 10 : 10;

    // defaults
    let target_sets: number = e.exercise_type === 2 ? 0 : 3; // NOT NULL safe
    let target_reps: number = e.exercise_type === 2 ? 0 : 10;
    let target_load_kg: number | null = null;
    let target_duration_sec: number | null = e.exercise_type === 2 ? 480 : null;

    if (e.exercise_type === 1) {
      const { data } = await supabase
        .from("v_last_exercise_values")
        .select("last_sets,last_reps,last_load_kg")
        .eq("exercise_id", e.exercise_id)
        .maybeSingle();

      target_sets = (data?.last_sets ?? 3) as number;
      target_reps = (data?.last_reps ?? 10) as number;
      target_load_kg = (data?.last_load_kg ?? null) as number | null;
    }

    const { error } = await supabase.from("workout_plan_item").insert({
      plan_id: planId,
      sequence_no: nextSeq,
      exercise_id: e.exercise_id,
      target_sets,
      target_reps,
      target_load_kg,
      target_duration_sec,
    });

    if (error) {
      setMsg(error.message);
      return;
    }

    setAddExerciseId("");
    setAddExerciseQuery("");
    await loadToday();
  };

  const payload: RowPayload[] = useMemo(() => {
    return rows.map((r) => {
      const k = rowKey(r);

      if (r.exercise_type === 2) {
        const mins = durationsMin[k] === "" || durationsMin[k] == null ? Math.round((r.target_duration_sec ?? 480) / 60) : Number(durationsMin[k]);
        return {
          sequence_no: r.sequence_no,
          name: r.exercise_name,
          duration_sec: Math.max(0, Math.round(mins * 60)),
        };
      }

      const s = sets[k] === "" || sets[k] == null ? (r.target_sets ?? 3) : Number(sets[k]);
      const rep = reps[k] === "" || reps[k] == null ? (r.target_reps ?? 10) : Number(reps[k]);
      const load = loads[k] === "" || loads[k] == null ? null : Number(loads[k]);

      return {
        sequence_no: r.sequence_no,
        name: r.exercise_name,
        sets: Array.from({ length: Math.max(1, s) }, () => ({ reps: rep, load_kg: load })),
      };
    });
  }, [rows, durationsMin, loads, reps, sets]);

  const saveSession = async () => {
    setMsg("");
    const planDate = todayIso();

    const ss = sessionStart || ensureSessionStart();

    if (!ss) {
      setMsg("No session started. Click New session first.");
      return;
    }

    // Validate reps before saving
    for (const r of rows) {
      if (r.exercise_type !== 1) continue;
      const k = rowKey(r);
      const repRaw = reps[k] === "" || reps[k] == null ? r.target_reps ?? 10 : Number(reps[k]);
      if (!isValidReps(repRaw)) {
        setMsg(`Reps out of range for "${r.exercise_name}" (must be ${REP_MIN}-${REP_MAX}).`);
        return;
      }
    }

    const { error } = await supabase.rpc("log_session_json", {
      p_session_start: ss,
      p_duration_min: durationMin,
      p_plan_date: planDate,
      p_rows: payload,
    });

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Saved.");
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
    ensureSessionStart();
  }, [isAuthed]);

  // Seed local edit state from rows (only if not already edited)
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

    setDurationsMin((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.exercise_type !== 2) continue;
        const k = rowKey(r);
        if (next[k] === undefined) next[k] = Math.round((r.target_duration_sec ?? 480) / 60);
      }
      return next;
    });
  }, [rows]);

  // Add exercise listbox options
  const filteredAddExercises = useMemo(() => {
    const q = addExerciseQuery.trim().toLowerCase();
    if (!q) return exerciseList;
    return exerciseList.filter((e) => e.canonical_name.toLowerCase().includes(q));
  }, [exerciseList, addExerciseQuery]);

  const addExerciseOptions = useMemo(() => {
    return filteredAddExercises.slice(0, ADD_EXERCISE_MAX_OPTIONS);
  }, [filteredAddExercises]);

  if (!isAuthed) {
    return (
      <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
        <h1>Log session</h1>
        <p>Sign in to continue.</p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ padding: 10, minWidth: 280 }}
          />
          <button onClick={signInMagicLink} style={{ padding: "10px 14px" }}>
            Send magic link
          </button>
        </div>
        {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
      </main>
    );
  }

  return (
    <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>Log session</h1>
      <div style={{ color: "#666", marginBottom: 12 }}>
        Plan date: <b>{todayIso()}</b> · Session start: <b>{sessionStart || "(not set)"}</b>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <button onClick={refreshPlan} style={{ padding: "10px 14px" }}>
          Refresh plan
        </button>
        <button onClick={loadToday} style={{ padding: "10px 14px" }}>
          Reload
        </button>
        <button onClick={newSession} style={{ padding: "10px 14px" }}>
          New session
        </button>

        <label style={{ marginLeft: 6 }}>
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

      {/* Add exercise: show full list and whittle down as you type */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            value={addExerciseQuery}
            onChange={(e) => setAddExerciseQuery(e.target.value)}
            placeholder="Type to filter…"
            style={{ padding: 10, minWidth: 260 }}
          />

          <select
            value={addExerciseId}
            onChange={(e) => setAddExerciseId(e.target.value === "" ? "" : Number(e.target.value))}
            size={10}
            style={{ padding: 10, minWidth: 320 }}
          >
            <option value="">Select exercise…</option>
            {addExerciseOptions.map((e) => (
              <option key={e.exercise_id} value={e.exercise_id}>
                {e.canonical_name}
              </option>
            ))}
          </select>

          {filteredAddExercises.length > ADD_EXERCISE_MAX_OPTIONS && (
            <div style={{ color: "#777", fontSize: 12 }}>
              Showing first {ADD_EXERCISE_MAX_OPTIONS} matches — keep typing to narrow.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 34 }}>
          <button onClick={addExercise} style={{ padding: "10px 14px" }}>
            Add
          </button>

          <button
            onClick={() => {
              setAddExerciseQuery("");
              setAddExerciseId("");
            }}
            style={{ padding: "10px 14px" }}
          >
            Clear
          </button>

          <a
            href="/exercises/new?return=/log"
            style={{
              padding: "10px 14px",
              border: "1px solid #ddd",
              borderRadius: 10,
              textDecoration: "none",
              background: "#eee",
              color: "#111", // ✅ visible on iOS dark mode
              fontWeight: 600,
            }}
          >
            New strength exercise
          </a>
        </div>
      </div>

      {msg && <div style={{ marginBottom: 14, color: msg === "Saved." ? "#0a7a0a" : "#b00020" }}>{msg}</div>}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>Exercise</th>
            <th style={th}>Edit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            const sk = slotKey(r.plan_date, r.sequence_no);

            return (
              <tr key={k}>
                <td style={td}>{r.sequence_no}</td>
                <td style={td}>{r.exercise_name}</td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      value={swapPick[sk] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        const id = Number(v);
                        setSwapPick((p) => ({ ...p, [sk]: id }));
                        void replaceExercise(r.sequence_no, id);
                      }}
                      style={{ padding: 10, minWidth: 220 }}
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
                      <label style={{ color: "#444" }}>
                        Target (min):{" "}
                        <input
                          type="number"
                          min={0}
                          value={durationsMin[k] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? "" : Number(e.target.value);
                            setDurationsMin((prev) => ({ ...prev, [k]: v }));
                            if (v !== "") queueAutosave(r.sequence_no, { target_duration_sec: Math.max(0, Math.round(v * 60)) });
                          }}
                          style={{ width: 90, padding: 6 }}
                        />
                      </label>
                    ) : (
                      <>
                        <label>
                          Reps:{" "}
                          <input
                            type="number"
                            min={REP_MIN}
                            max={REP_MAX}
                            value={reps[k] ?? ""}
                            onChange={(e) => {
                              if (e.target.value === "") {
                                setReps((prev) => ({ ...prev, [k]: "" }));
                                return;
                              }

                              const raw = Number(e.target.value);
                              setReps((prev) => ({ ...prev, [k]: raw }));

                              if (!isValidReps(raw)) {
                                setMsg(`Reps must be ${REP_MIN}-${REP_MAX}.`);
                                return;
                              }

                              queueAutosave(r.sequence_no, { target_reps: raw });
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
                            min={0}
                            max={10}
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
    </main>
  );
}

const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #ddd", padding: 10 };
const td: React.CSSProperties = { borderBottom: "1px solid #eee", padding: 10, verticalAlign: "top" };

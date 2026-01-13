"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type PlanRow = {
  person_id: number;
  plan_date: string;
  sequence_no: number;
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

type LastVals = {
  exercise_id: number;
  last_sets: number | null;
  last_reps: number | null;
  last_load_kg: number | null;
  last_session_start: string | null;
};

type StrengthSet = { reps: number; load_kg: number | null };
type RowPayload =
  | { sequence_no: number; name: string; duration_sec: number }
  | { sequence_no: number; name: string; sets: StrengthSet[] };

const todayIso = () => new Date().toISOString().slice(0, 10);
const rowKey = (plan_date: string, sequence_no: number) => `${plan_date}-${sequence_no}`;

const REP_MIN = 8;
const REP_MAX = 20;
const isValidReps = (n: number) => Number.isFinite(n) && n >= REP_MIN && n <= REP_MAX;

export default function LogPage() {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const [rows, setRows] = useState<PlanRow[]>([]);
  const [exerciseList, setExerciseList] = useState<Exercise[]>([]);
  const [addExerciseQuery, setAddExerciseQuery] = useState("");
  const [addExerciseId, setAddExerciseId] = useState<number | "">("");

  // local edits
  const [sets, setSets] = useState<Record<string, number | "">>({});
  const [reps, setReps] = useState<Record<string, number | "">>({});
  const [loads, setLoads] = useState<Record<string, number | "" | null>>({});
  const [durSec, setDurSec] = useState<Record<string, number | "">>({});

  // row-level reps validation state (so cardio doesn’t trigger it)
  const [repErr, setRepErr] = useState<Record<string, string>>({});

  // stable session_start
  const SESSION_KEY = `gym.session_start.${todayIso()}`;
  const [sessionStart, setSessionStart] = useState<string>("");

  // autosave debounce
  const timers = useRef<Record<string, any>>({});

  const clearMsgSoon = () => {
    // don’t fight user; only clear on next interaction
  };

  const loadAll = async () => {
    setLoading(true);
    setMsg("");

    const plan_date = todayIso();

    const [planRes, exRes] = await Promise.all([
      supabase
        .from("v_plan_today_edit")
        .select("*")
        .eq("plan_date", plan_date)
        .order("sequence_no", { ascending: true }),
      supabase
        .from("exercise")
        .select("exercise_id, canonical_name, exercise_type")
        .order("canonical_name", { ascending: true }),
    ]);

    if (planRes.error) setMsg(planRes.error.message);
    if (exRes.error) setMsg(exRes.error.message);

    setRows((planRes.data ?? []) as PlanRow[]);
    setExerciseList((exRes.data ?? []) as Exercise[]);

    // session_start only exists once user started/continued a session
    const existing = window.localStorage.getItem(SESSION_KEY);
    setSessionStart(existing || "");

    setLoading(false);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getPlanId = async (): Promise<number | null> => {
    const plan_date = todayIso();
    const { data, error } = await supabase
      .from("workout_plan")
      .select("plan_id")
      .eq("plan_date", plan_date)
      .maybeSingle();

    if (error) {
      setMsg(error.message);
      return null;
    }
    return data?.plan_id ?? null;
  };

  const queueAutosave = (sequence_no: number, patch: Record<string, any>) => {
    void (async () => {
      const plan_id = await getPlanId();
      if (!plan_id) return;

      const k = `${plan_id}-${sequence_no}`;
      if (timers.current[k]) clearTimeout(timers.current[k]);

      timers.current[k] = setTimeout(async () => {
        const { error } = await supabase
          .from("workout_plan_item")
          .update(patch)
          .eq("plan_id", plan_id)
          .eq("sequence_no", sequence_no);

        if (error) setMsg(error.message);
      }, 500);
    })();
  };

  const startNewSession = () => {
    const iso = new Date().toISOString();
    window.localStorage.setItem(SESSION_KEY, iso);
    setSessionStart(iso);
    setMsg("New session started.");
  };

  const refreshPlan = async () => {
    setMsg("");
    const plan_date = todayIso();

    // keep your original authoritative function call
    const { error } = await supabase.rpc("generate_plan", {
      p_plan_date: plan_date,
      p_cooldown_days: 10,
    });

    if (error) {
      setMsg(error.message);
      return;
    }

    await loadAll();
    setMsg("Plan refreshed.");
  };

  const fetchLastVals = async (exercise_id: number): Promise<LastVals | null> => {
    const { data, error } = await supabase
      .from("v_last_exercise_values")
      .select("exercise_id,last_sets,last_reps,last_load_kg,last_session_start")
      .eq("exercise_id", exercise_id)
      .maybeSingle();

    if (error) {
      setMsg(error.message);
      return null;
    }
    return (data ?? null) as LastVals | null;
  };

  // Init UI defaults from plan, but if plan fields are null, fall back to last values (no DB write)
  useEffect(() => {
    if (!rows.length) return;

    void (async () => {
      const nextSets: Record<string, number | ""> = {};
      const nextReps: Record<string, number | ""> = {};
      const nextLoads: Record<string, number | "" | null> = {};
      const nextDur: Record<string, number | ""> = {};

      for (const r of rows) {
        const k = rowKey(r.plan_date, r.sequence_no);

        if (r.exercise_type === 2) {
          nextDur[k] = r.target_duration_sec ?? 2400;
          continue;
        }

        const lv = r.exercise_id ? await fetchLastVals(r.exercise_id) : null;

        nextSets[k] = r.target_sets ?? lv?.last_sets ?? 3;
        nextReps[k] = r.target_reps ?? lv?.last_reps ?? 10;
        nextLoads[k] = r.suggested_load_kg ?? lv?.last_load_kg ?? null;
      }

      setSets((p) => ({ ...nextSets, ...p }));
      setReps((p) => ({ ...nextReps, ...p }));
      setLoads((p) => ({ ...nextLoads, ...p }));
      setDurSec((p) => ({ ...nextDur, ...p }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const filteredAddExercises = useMemo(() => {
    const q = addExerciseQuery.trim().toLowerCase();
    if (!q) return exerciseList;
    return exerciseList.filter((e) => e.canonical_name.toLowerCase().includes(q));
  }, [exerciseList, addExerciseQuery]);

  const addExercise = async () => {
    setMsg("");
    if (addExerciseId === "") return;

    const plan_id = await getPlanId();
    if (!plan_id) return;

    const ex = exerciseList.find((x) => x.exercise_id === addExerciseId);
    if (!ex) return;

    const plan_date = todayIso();
    const maxSeq = rows.reduce((m, r) => Math.max(m, r.sequence_no), 0);
    const sequence_no = maxSeq + 10;

    if (ex.exercise_type === 1) {
      const lv = await fetchLastVals(ex.exercise_id);
      const target_sets = lv?.last_sets ?? 3;
      const target_reps = lv?.last_reps ?? 10;
      const target_load_kg = lv?.last_load_kg ?? null;

      const { error } = await supabase.from("workout_plan_item").insert({
        plan_id,
        sequence_no,
        exercise_id: ex.exercise_id,
        // IMPORTANT: satisfy NOT NULL constraints
        target_sets,
        target_reps,
        target_load_kg,
        target_duration_sec: 0,
      });

      if (error) {
        setMsg(error.message);
        return;
      }
    } else {
      // cardio: IMPORTANT: satisfy NOT NULL constraints (use 0s)
      const { error } = await supabase.from("workout_plan_item").insert({
        plan_id,
        sequence_no,
        exercise_id: ex.exercise_id,
        target_sets: 0,
        target_reps: 0,
        target_load_kg: null,
        target_duration_sec: 600, // 10 min warm-up default (editable)
      });

      if (error) {
        setMsg(error.message);
        return;
      }
    }

    setAddExerciseId("");
    setAddExerciseQuery("");
    await loadAll();
    setMsg("Exercise added.");
  };

  const removeExercise = async (sequence_no: number) => {
    setMsg("");
    const plan_id = await getPlanId();
    if (!plan_id) return;

    const { error } = await supabase
      .from("workout_plan_item")
      .delete()
      .eq("plan_id", plan_id)
      .eq("sequence_no", sequence_no);

    if (error) {
      setMsg(error.message);
      return;
    }

    await loadAll();
    setMsg("Exercise removed.");
  };

  const replaceExercise = async (sequence_no: number, new_exercise_id: number) => {
    setMsg("");
    const plan_id = await getPlanId();
    if (!plan_id) return;

    const newEx = exerciseList.find((x) => x.exercise_id === new_exercise_id);
    if (!newEx) return;

    // swap in DB
    const { error } = await supabase
      .from("workout_plan_item")
      .update({ exercise_id: new_exercise_id })
      .eq("plan_id", plan_id)
      .eq("sequence_no", sequence_no);

    if (error) {
      setMsg(error.message);
      return;
    }

    // IMPORTANT: if swapping to cardio, ensure NOT NULL targets exist
    if (newEx.exercise_type === 2) {
      await supabase
        .from("workout_plan_item")
        .update({
          target_sets: 0,
          target_reps: 0,
          target_load_kg: null,
          target_duration_sec: 600,
        })
        .eq("plan_id", plan_id)
        .eq("sequence_no", sequence_no);
    } else {
      // strength: pull last values and write them immediately
      const lv = await fetchLastVals(new_exercise_id);
      const target_sets = lv?.last_sets ?? 3;
      const target_reps = lv?.last_reps ?? 10;
      const target_load_kg = lv?.last_load_kg ?? null;

      await supabase
        .from("workout_plan_item")
        .update({
          target_sets,
          target_reps,
          target_load_kg,
          target_duration_sec: 0,
        })
        .eq("plan_id", plan_id)
        .eq("sequence_no", sequence_no);
    }

    await loadAll();

    // clear local rep error for that slot
    const k = rowKey(todayIso(), sequence_no);
    setRepErr((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });

    setMsg("Exercise swapped.");
  };

  const payload: RowPayload[] = useMemo(() => {
    return rows.map((r) => {
      const k = rowKey(r.plan_date, r.sequence_no);

      if (r.exercise_type === 2) {
        const s = durSec[k] === "" || durSec[k] == null ? r.target_duration_sec ?? 600 : Number(durSec[k]);
        const duration_sec = Number.isFinite(s) ? Math.trunc(s) : 600;
        return { sequence_no: r.sequence_no, name: r.exercise_name, duration_sec };
      }

      const sCount = sets[k] === "" || sets[k] == null ? r.target_sets ?? 3 : Number(sets[k]);
      const rep = reps[k] === "" || reps[k] == null ? r.target_reps ?? 10 : Number(reps[k]);
      const load =
        loads[k] === "" || loads[k] == null
          ? r.suggested_load_kg ?? null
          : loads[k] === null
          ? null
          : Number(loads[k]);

      const setCount = Number.isFinite(sCount) ? Math.max(1, Math.trunc(sCount)) : 3;
      const repInt = Number.isFinite(rep) ? Math.trunc(rep) : 10;

      return {
        sequence_no: r.sequence_no,
        name: r.exercise_name,
        sets: Array.from({ length: setCount }, () => ({
          reps: repInt,
          load_kg: load == null || Number.isNaN(load) ? null : load,
        })),
      };
    });
  }, [rows, sets, reps, loads, durSec]);

  const saveSession = async () => {
    setMsg("");

    if (!sessionStart) {
      setMsg("No session started. Click New session first.");
      return;
    }

    // Validate reps ONLY for strength rows
    for (const r of rows) {
      if (r.exercise_type !== 1) continue;
      const k = rowKey(r.plan_date, r.sequence_no);
      const repRaw = reps[k] === "" || reps[k] == null ? r.target_reps ?? 10 : Number(reps[k]);
      const repInt = Number.isFinite(repRaw) ? Math.trunc(repRaw) : NaN;

      if (!isValidReps(repInt)) {
        setRepErr((p) => ({ ...p, [k]: `Reps must be ${REP_MIN}-${REP_MAX}` }));
        setMsg(`Reps out of range for "${r.exercise_name}" (${REP_MIN}-${REP_MAX}).`);
        return;
      }
    }

    const { error } = await supabase.rpc("log_session_json", {
      p_session_start: sessionStart,
      p_duration_min: 60,
      p_rows: payload,
    });

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Session saved.");
  };

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;

  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      {/* ACTION BAR (Save button always visible) */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Log ({todayIso()})</h2>

        <button onClick={refreshPlan} style={{ padding: "8px 12px" }}>
          Refresh plan
        </button>

        <button onClick={startNewSession} style={{ padding: "8px 12px" }}>
          New session
        </button>

        <button onClick={saveSession} style={{ padding: "8px 12px", fontWeight: 700 }}>
          Save session
        </button>

        <span style={{ color: "#666" }}>
          Session: <b>{sessionStart ? sessionStart : "—"}</b>
        </span>
      </div>

      {msg ? (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid #ddd", borderRadius: 10, color: "#b00020" }}>
          {msg}
        </div>
      ) : null}

      {/* ADD EXERCISE (full list + narrows as you type) */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Add exercise</div>

          <input
            value={addExerciseQuery}
            onChange={(e) => setAddExerciseQuery(e.target.value)}
            placeholder="Type to filter…"
            style={{ padding: 10, minWidth: 280 }}
          />

          <select
            value={addExerciseId}
            onChange={(e) => setAddExerciseId(e.target.value === "" ? "" : Number(e.target.value))}
            size={10}
            style={{ padding: 10, minWidth: 360 }}
          >
            <option value="">Select…</option>
            {filteredAddExercises.map((e) => (
              <option key={e.exercise_id} value={e.exercise_id}>
                {e.canonical_name}
              </option>
            ))}
          </select>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={addExercise} style={{ padding: "8px 12px" }}>
              Add
            </button>
            <button
              onClick={() => {
                setAddExerciseId("");
                setAddExerciseQuery("");
              }}
              style={{ padding: "8px 12px" }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* ROWS */}
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
            const k = rowKey(r.plan_date, r.sequence_no);

            const curSets = sets[k] === "" || sets[k] == null ? r.target_sets ?? 3 : Number(sets[k]);
            const curReps = reps[k] === "" || reps[k] == null ? r.target_reps ?? 10 : Number(reps[k]);
            const curLoad =
              loads[k] === "" || loads[k] == null ? r.suggested_load_kg ?? null : (loads[k] as number | null);

            const curDur = durSec[k] === "" || durSec[k] == null ? r.target_duration_sec ?? 600 : Number(durSec[k]);

            return (
              <tr key={k}>
                <td style={td}>{r.sequence_no}</td>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>{r.exercise_name}</div>
                  {repErr[k] ? <div style={{ color: "#b00020", marginTop: 6 }}>{repErr[k]}</div> : null}
                </td>

                <td style={td}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        void replaceExercise(r.sequence_no, Number(v));
                        e.currentTarget.value = "";
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

                    <button onClick={() => void removeExercise(r.sequence_no)} style={{ padding: "8px 12px" }}>
                      Remove
                    </button>

                    {r.exercise_type === 2 ? (
                      <>
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          Minutes:
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={Math.round((Number(curDur) || 600) / 60)}
                            onChange={(e) => {
                              const mins = e.target.value === "" ? 10 : Number(e.target.value);
                              const sec = Math.max(60, Math.trunc(mins * 60));
                              setDurSec((p) => ({ ...p, [k]: sec }));
                              queueAutosave(r.sequence_no, { target_duration_sec: sec });
                            }}
                            style={{ width: 90, padding: 6 }}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          Sets:
                          <input
                            type="number"
                            min={1}
                            max={10}
                            step={1}
                            value={Number.isFinite(curSets) ? curSets : 3}
                            onChange={(e) => {
                              const v = e.target.value === "" ? "" : Math.max(1, Math.trunc(Number(e.target.value)));
                              setSets((p) => ({ ...p, [k]: v }));
                              if (v !== "") queueAutosave(r.sequence_no, { target_sets: v });
                            }}
                            style={{ width: 80, padding: 6 }}
                          />
                        </label>

                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          Reps:
                          <input
                            type="number"
                            min={REP_MIN}
                            max={REP_MAX}
                            step={1}
                            value={Number.isFinite(curReps) ? curReps : 10}
                            onChange={(e) => {
                              const raw = e.target.value === "" ? "" : Math.trunc(Number(e.target.value));
                              setReps((p) => ({ ...p, [k]: raw as any }));

                              // block autosave if invalid
                              if (raw === "" || !isValidReps(Number(raw))) {
                                setRepErr((p) => ({ ...p, [k]: `Reps must be ${REP_MIN}-${REP_MAX}` }));
                                return;
                              }

                              setRepErr((p) => {
                                const n = { ...p };
                                delete n[k];
                                return n;
                              });

                              queueAutosave(r.sequence_no, { target_reps: Number(raw) });
                            }}
                            style={{ width: 80, padding: 6 }}
                          />
                        </label>

                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          Load (kg):
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={curLoad == null ? "" : curLoad}
                            onChange={(e) => {
                              const v = e.target.value === "" ? "" : Number(e.target.value);
                              setLoads((p) => ({ ...p, [k]: v as any }));
                              if (v !== "") queueAutosave(r.sequence_no, { target_load_kg: v });
                            }}
                            style={{ width: 110, padding: 6 }}
                          />
                        </label>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}

          {rows.length === 0 ? (
            <tr>
              <td style={td} colSpan={3}>
                No rows for today.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" };
const td: React.CSSProperties = { padding: 10, borderBottom: "1px solid #eee", verticalAlign: "top" };

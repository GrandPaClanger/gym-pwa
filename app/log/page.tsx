"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  // optional (some views include it)
  target_load_kg?: number | null;
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

type PlanItemPatch = {
  exercise_id?: number;
  target_sets?: number;
  target_reps?: number;
  target_load_kg?: number | null;
  target_duration_sec?: number | null;
  notes?: string | null;
};

const REP_MIN = 8;
const REP_MAX = 20;
const ADD_EXERCISE_MAX_OPTIONS = 500;

const todayIso = () => new Date().toISOString().slice(0, 10);
const rowKey = (planDate: string, seq: number) => `${planDate}-${seq}`;

const hasKey = (obj: Record<string, any>, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);

const clampReps = (v: number) => Math.max(REP_MIN, Math.min(REP_MAX, Math.round(v)));
const isValidReps = (v: number) => Number.isFinite(v) && v >= REP_MIN && v <= REP_MAX;

export default function LogPage() {
  // auth
  const [email, setEmail] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);

  // data
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [exerciseList, setExerciseList] = useState<Exercise[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);

  // UI
  const [msg, setMsg] = useState<string>("");

  // stable session start (per day)
  const [sessionStart, setSessionStart] = useState<string>("");
  const [sessionDurationMin, setSessionDurationMin] = useState<number>(60);

  // debounced timers per plan row
  const autosaveTimers = useRef<Record<string, any>>({});

  // local edits keyed by plan-date + sequence
  const [sets, setSets] = useState<Record<string, number | "">>({});
  const [reps, setReps] = useState<Record<string, number | "">>({});
  const [loads, setLoads] = useState<Record<string, number | "">>({});
  const [durationsMin, setDurationsMin] = useState<Record<string, number | "">>({}); // cardio minutes UI

  // add exercise
  const [addExerciseId, setAddExerciseId] = useState<number | "">("");
  const [addExerciseQuery, setAddExerciseQuery] = useState<string>("");

  // swap
  const [swapPick, setSwapPick] = useState<Record<string, number | "">>({});

  const signInMagicLink = async () => {
    setMsg("");
    const { error } = await supabase.auth.signInWithOtp({ email });
    setMsg(error ? error.message : "Check your email for the magic link.");
  };

  const sessionKeyForToday = () => `gym.session_start.${todayIso()}`;

  const ensureSessionStart = () => {
    const k = sessionKeyForToday();
    const existing = window.localStorage.getItem(k);
    if (existing) {
      setSessionStart(existing);
      return existing;
    }
    const fresh = new Date().toISOString();
    window.localStorage.setItem(k, fresh);
    setSessionStart(fresh);
    return fresh;
  };

  const newSession = () => {
    const k = sessionKeyForToday();
    const fresh = new Date().toISOString();
    window.localStorage.setItem(k, fresh);
    setSessionStart(fresh);
    setMsg("New session started.");
  };

  const loadExerciseList = async () => {
    const { data, error } = await supabase
      .from("exercise")
      .select("exercise_id, canonical_name, exercise_type")
      .eq("is_active", true)
      .order("canonical_name", { ascending: true });

    if (error) {
      setMsg(error.message);
      return;
    }
    setExerciseList((data as Exercise[]) ?? []);
  };

  const getPersonId = async (): Promise<number | null> => {
    if (rows.length > 0) return rows[0].person_id;
    const { data, error } = await supabase.rpc("my_person_id");
    if (error) return null;
    const n = Number(data);
    return Number.isFinite(n) ? n : null;
  };

  const loadPlanIdForToday = async (): Promise<number | null> => {
    const pid = await getPersonId();
    if (!pid) return null;

    const { data, error } = await supabase
      .from("workout_plan")
      .select("plan_id")
      .eq("person_id", pid)
      .eq("plan_date", todayIso())
      .order("plan_id", { ascending: false })
      .limit(1);

    if (error) return null;
    const id = (data as any[])?.[0]?.plan_id;
    const n = Number(id);
    if (!Number.isFinite(n)) return null;
    setPlanId(n);
    return n;
  };

  const requirePlanId = async (): Promise<number | null> => {
    if (planId) return planId;
    return await loadPlanIdForToday();
  };

  const getRowDefaultLoad = (r: PlanRow) => {
    const tl = (r as any).target_load_kg;
    if (tl !== undefined && tl !== null) return Number(tl);
    return r.suggested_load_kg ?? null;
  };

  const loadToday = async () => {
    setMsg("");
    const planDate = todayIso();

    // Select * to avoid schema-cache/column mismatch as this view evolves.
    const { data, error } = await supabase
      .from("v_plan_today_edit")
      .select("*")
      .eq("plan_date", planDate)
      .order("sequence_no", { ascending: true });

    if (error) {
      setMsg(error.message);
      return;
    }

    const r = (data as PlanRow[]) ?? [];
    setRows(r);

    // also load plan_id (needed for updates/inserts/deletes)
    void loadPlanIdForToday();

    // seed UI fields from plan values
    const nextSets: Record<string, number | ""> = {};
    const nextReps: Record<string, number | ""> = {};
    const nextLoads: Record<string, number | ""> = {};
    const nextDurMin: Record<string, number | ""> = {};

    for (const row of r) {
      const k = rowKey(row.plan_date, row.sequence_no);

      if (row.exercise_type === 1) {
        nextSets[k] = row.target_sets ?? 3;
        nextReps[k] = row.target_reps ?? 10;
        const d = getRowDefaultLoad(row);
        nextLoads[k] = d ?? "";
      } else {
        const mins = row.target_duration_sec != null ? Math.round(row.target_duration_sec / 60) : 0;
        nextDurMin[k] = mins;
      }
    }

    setSets(nextSets);
    setReps(nextReps);
    setLoads(nextLoads);
    setDurationsMin(nextDurMin);
  };

  const refreshPlan = async () => {
    setMsg("");
    const p_start_date = todayIso();
    const p_days = 1;

    // wrapper: public.generate_plan(p_days int, p_start_date date)
    const { data, error } = await supabase.rpc("generate_plan", { p_days, p_start_date });
    if (error) {
      setMsg(error.message);
      return;
    }

    // sometimes the function returns a plan_id; use it if present
    if (data != null) {
      const n = Number(data);
      if (Number.isFinite(n)) setPlanId(n);
    }

    await loadToday();
    setMsg("Plan refreshed.");
  };

  const queueAutosave = (sequence_no: number, patch: PlanItemPatch) => {
    const planDate = todayIso();
    const k = rowKey(planDate, sequence_no);

    if (autosaveTimers.current[k]) clearTimeout(autosaveTimers.current[k]);

    autosaveTimers.current[k] = setTimeout(async () => {
      autosaveTimers.current[k] = null;

      const pid = await requirePlanId();
      if (!pid) {
        setMsg("No plan loaded. Click Refresh plan.");
        return;
      }

      const { error } = await supabase
        .from("workout_plan_item")
        .update(patch)
        .eq("plan_id", pid)
        .eq("sequence_no", sequence_no);

      if (error) setMsg(error.message);
    }, 500);
  };

  const addExerciseToPlan = async () => {
    setMsg("");
    if (addExerciseId === "") return;

    const pid = await requirePlanId();
    if (!pid) {
      setMsg("No plan loaded. Click Refresh plan.");
      return;
    }

    const ex = exerciseList.find((x) => x.exercise_id === Number(addExerciseId));
    if (!ex) {
      setMsg("Exercise not found.");
      return;
    }

    const maxSeq = rows.reduce((m, r) => Math.max(m, r.sequence_no), 0);
    const newSeq = maxSeq + 10;

    // IMPORTANT: workout_plan_item does NOT have exercise_name/exercise_type/plan_date.
    // It needs plan_id + sequence_no + exercise_id, plus NOT NULL targets.
    const insertRow: any = {
      plan_id: pid,
      sequence_no: newSeq,
      exercise_id: ex.exercise_id,
      target_sets: 3,
      target_reps: 10,
      target_load_kg: null,
      target_duration_sec: null,
    };

    if (ex.exercise_type === 2) {
      insertRow.target_duration_sec = 8 * 60; // default 8 min
    }

    const { error } = await supabase.from("workout_plan_item").insert(insertRow);
    if (error) {
      setMsg(error.message);
      return;
    }

    setAddExerciseId("");
    await loadToday();
    setMsg("Exercise added.");
  };

  const removeExercise = async (sequence_no: number) => {
    setMsg("");
    const pid = await requirePlanId();
    if (!pid) {
      setMsg("No plan loaded. Click Refresh plan.");
      return;
    }

    const { error } = await supabase
      .from("workout_plan_item")
      .delete()
      .eq("plan_id", pid)
      .eq("sequence_no", sequence_no);

    if (error) {
      setMsg(error.message);
      return;
    }

    await loadToday();
    setMsg("Removed.");
  };

  const replaceExercise = async (sequence_no: number, newExerciseId: number) => {
    setMsg("");
    const pid = await requirePlanId();
    if (!pid) {
      setMsg("No plan loaded. Click Refresh plan.");
      return;
    }

    const ex = exerciseList.find((x) => x.exercise_id === newExerciseId);
    if (!ex) {
      setMsg("Exercise not found.");
      return;
    }

    // Keep NOT NULL columns valid. For cardio rows, sets/reps can stay defaulted.
    const patch: PlanItemPatch = {
      exercise_id: ex.exercise_id,
      target_sets: 3,
      target_reps: 10,
      target_load_kg: null,
      target_duration_sec: ex.exercise_type === 2 ? 8 * 60 : null,
    };

    const { error } = await supabase
      .from("workout_plan_item")
      .update(patch)
      .eq("plan_id", pid)
      .eq("sequence_no", sequence_no);

    if (error) {
      setMsg(error.message);
      return;
    }

    // clear local edits for this slot (otherwise old values stick)
    const sk = rowKey(todayIso(), sequence_no);
    setLoads((p) => {
      const n = { ...p };
      delete n[sk];
      return n;
    });
    setReps((p) => {
      const n = { ...p };
      delete n[sk];
      return n;
    });
    setSets((p) => {
      const n = { ...p };
      delete n[sk];
      return n;
    });
    setDurationsMin((p) => {
      const n = { ...p };
      delete n[sk];
      return n;
    });

    await loadToday();
    setMsg("Swapped.");
  };

  const payload: RowPayload[] = useMemo(() => {
    const planDate = todayIso();
    const out: RowPayload[] = [];

    for (const r of rows) {
      const k = rowKey(planDate, r.sequence_no);

      if (r.exercise_type === 2) {
        const defaultMins = Math.round((r.target_duration_sec ?? 0) / 60);
        const minsRaw = hasKey(durationsMin, k) ? durationsMin[k] : defaultMins;
        const mins = minsRaw === "" ? defaultMins : Number(minsRaw);

        out.push({
          sequence_no: r.sequence_no,
          name: r.exercise_name,
          duration_sec: Math.max(0, Math.round(mins * 60)),
        });
        continue;
      }

      const defaultSets = r.target_sets ?? 3;
      const defaultReps = r.target_reps ?? 10;
      const defaultLoad = getRowDefaultLoad(r); // number | null

      const setRaw = hasKey(sets, k) ? sets[k] : defaultSets;
      const setCount = setRaw === "" ? defaultSets : Number(setRaw);

      const repRaw = hasKey(reps, k) ? reps[k] : defaultReps;
      const repNum = repRaw === "" ? defaultReps : Number(repRaw);
      const rep = clampReps(repNum);

      const loadRaw = hasKey(loads, k) ? loads[k] : defaultLoad;
      const load =
        loadRaw == null || loadRaw == "" || Number.isNaN(Number(loadRaw)) ? null : Number(loadRaw);

      const setsArr: StrengthSet[] = [];
      for (let i = 0; i < Math.max(1, Math.round(setCount)); i++) {
        setsArr.push({ reps: rep, load_kg: load });
      }

      out.push({ sequence_no: r.sequence_no, name: r.exercise_name, sets: setsArr });
    }

    return out;
  }, [rows, sets, reps, loads, durationsMin]);

  const saveSession = async () => {
    setMsg("");

    // Always have a stable session_start
    let ss = sessionStart;
    if (!ss) ss = ensureSessionStart();

    // reps validation (strength only)
    for (const r of rows) {
      if (r.exercise_type !== 1) continue;
      const k = rowKey(todayIso(), r.sequence_no);

      const defaultReps = r.target_reps ?? 10;
      const repRaw = hasKey(reps, k) ? reps[k] : defaultReps;
      const repNum = repRaw === "" ? defaultReps : Number(repRaw);

      if (!isValidReps(repNum)) {
        setMsg(`Reps out of range for "${r.exercise_name}" (must be ${REP_MIN}-${REP_MAX}).`);
        return;
      }
    }

    // DB signature: (p_session_start timestamptz, p_duration_min smallint, p_rows jsonb)
    const { error } = await supabase.rpc("log_session_json", {
      p_session_start: ss,
      p_duration_min: sessionDurationMin,
      p_rows: payload,
    });

    setMsg(error ? error.message : "Session saved.");
  };

  // init auth + stable session start
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setIsAuthed(!!data.session);
      if (data.session) ensureSessionStart();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setIsAuthed(!!session);
      if (session) ensureSessionStart();
    });

    return () => {
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // initial loads
  useEffect(() => {
    if (!isAuthed) return;
    void loadExerciseList();
    void loadToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  const filteredAddExercises = useMemo(() => {
    const q = addExerciseQuery.trim().toLowerCase();
    if (!q) return exerciseList;
    return exerciseList.filter((e) => e.canonical_name.toLowerCase().includes(q));
  }, [exerciseList, addExerciseQuery]);

  const addExerciseOptions = useMemo(() => {
    return filteredAddExercises.slice(0, ADD_EXERCISE_MAX_OPTIONS);
  }, [filteredAddExercises]);

  const swapOptions = useMemo(() => exerciseList.slice(0, 1000), [exerciseList]);

  // Styles
  const th: React.CSSProperties = { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #333" };
  const td: React.CSSProperties = { padding: "10px 8px", borderBottom: "1px solid #222", verticalAlign: "top" };

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
        Plan date: <b>{todayIso()}</b> · Plan ID: <b>{planId ?? "(unknown)"}</b> · Session start:{" "}
        <b>{sessionStart || "(not set)"}</b>
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
            value={sessionDurationMin}
            onChange={(e) => setSessionDurationMin(Number(e.target.value))}
            style={{ width: 90, padding: 6 }}
          />
        </label>

        <button onClick={saveSession} style={{ padding: "10px 14px", marginLeft: 6 }}>
          Save session
        </button>
      </div>

      {msg && <div style={{ marginBottom: 14, color: msg === "Session saved." ? "#0a7a0a" : "#b00020" }}>{msg}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input
          value={addExerciseQuery}
          onChange={(e) => setAddExerciseQuery(e.target.value)}
          placeholder="Type to filter…"
          style={{ padding: 10, minWidth: 320 }}
        />

        <select
          value={addExerciseId}
          onChange={(e) => setAddExerciseId(e.target.value === "" ? "" : Number(e.target.value))}
          style={{ padding: 10, minWidth: 320 }}
        >
          <option value="">Select exercise…</option>
          {addExerciseOptions.map((e) => (
            <option key={e.exercise_id} value={e.exercise_id}>
              {e.canonical_name}
            </option>
          ))}
        </select>

        <button onClick={addExerciseToPlan} style={{ padding: "10px 14px" }}>
          Add
        </button>

        <a
          href="/exercises/new"
          style={{
            padding: "10px 14px",
            border: "1px solid #888",
            borderRadius: 8,
            textDecoration: "none",
            color: "#111",
            background: "#eee",
            display: "inline-block",
          }}
        >
          New strength exercise
        </a>

        {filteredAddExercises.length > ADD_EXERCISE_MAX_OPTIONS && (
          <span style={{ color: "#b00020" }}>
            Too many matches ({filteredAddExercises.length}). Add more text to filter.
          </span>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Seq</th>
              <th style={th}>Exercise</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const planDate = todayIso();
              const k = rowKey(planDate, r.sequence_no);

              const showSets = hasKey(sets, k) ? sets[k] : (r.target_sets ?? 3);
              const showReps = hasKey(reps, k) ? reps[k] : (r.target_reps ?? 10);

              const defaultLoad = getRowDefaultLoad(r);
              const showLoad = hasKey(loads, k) ? loads[k] : (defaultLoad ?? "");

              const targetMin = r.target_duration_sec != null ? Math.round(r.target_duration_sec / 60) : 0;
              const showMin = hasKey(durationsMin, k) ? durationsMin[k] : targetMin;

              return (
                <tr key={k}>
                  <td style={td}>{r.sequence_no}</td>
                  <td style={td}>
                    <b>{r.exercise_name}</b>

                    {r.exercise_type === 1 && (
                      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <label>
                          Reps:
                          <input
                            type="number"
                            min={REP_MIN}
                            max={REP_MAX}
                            value={showReps as any}
                            onChange={(e) => {
                              const raw = e.target.value === "" ? "" : Number(e.target.value);
                              setReps((prev) => ({ ...prev, [k]: raw }));
                              if (raw !== "") queueAutosave(r.sequence_no, { target_reps: clampReps(raw) });
                            }}
                            style={{ width: 90, marginLeft: 6, padding: 6 }}
                          />
                        </label>

                        <label>
                          Load (kg):
                          <input
                            type="number"
                            value={showLoad as any}
                            onChange={(e) => {
                              const v = e.target.value === "" ? "" : Number(e.target.value);
                              setLoads((prev) => ({ ...prev, [k]: v }));
                              if (v !== "") queueAutosave(r.sequence_no, { target_load_kg: v });
                            }}
                            style={{ width: 110, marginLeft: 6, padding: 6 }}
                          />
                        </label>

                        <label>
                          Sets:
                          <input
                            type="number"
                            value={showSets as any}
                            onChange={(e) => {
                              const v = e.target.value === "" ? "" : Number(e.target.value);
                              setSets((prev) => ({ ...prev, [k]: v }));
                              if (v !== "") queueAutosave(r.sequence_no, { target_sets: Math.max(1, Math.round(v)) });
                            }}
                            style={{ width: 70, marginLeft: 6, padding: 6 }}
                          />
                        </label>
                      </div>
                    )}

                    {r.exercise_type === 2 && (
                      <div style={{ marginTop: 10 }}>
                        Target: <b>{targetMin} min</b> · Duration (min):{" "}
                        <input
                          type="number"
                          min={0}
                          value={showMin as any}
                          onChange={(e) => {
                            const v = e.target.value === "" ? "" : Number(e.target.value);
                            setDurationsMin((prev) => ({ ...prev, [k]: v }));
                            if (v !== "") queueAutosave(r.sequence_no, { target_duration_sec: Math.max(0, Math.round(v * 60)) });
                          }}
                          style={{ width: 90, marginLeft: 6, padding: 6 }}
                        />
                      </div>
                    )}
                  </td>

                  <td style={td}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <select
                        value={swapPick[k] ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return;
                          const id = Number(v);
                          setSwapPick((p) => ({ ...p, [k]: id }));
                          void replaceExercise(r.sequence_no, id);
                          setSwapPick((p) => ({ ...p, [k]: "" }));
                        }}
                        style={{ padding: 10, minWidth: 220 }}
                      >
                        <option value="">Swap…</option>
                        {swapOptions.map((e) => (
                          <option key={e.exercise_id} value={e.exercise_id}>
                            {e.canonical_name}
                          </option>
                        ))}
                      </select>

                      <button onClick={() => void removeExercise(r.sequence_no)} style={{ padding: "10px 14px" }}>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td style={td} colSpan={3}>
                  No rows. Click <b>Refresh plan</b>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

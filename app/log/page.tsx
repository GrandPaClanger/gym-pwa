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
  // some views expose one or both of these
  suggested_load_kg?: number | null;
  target_load_kg?: number | null;
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

  // auth (optional but helps with RLS)
  const [isAuthed, setIsAuthed] = useState(false);
  const [email, setEmail] = useState("");

  // Add exercise UI
  const [addExerciseQuery, setAddExerciseQuery] = useState("");
  const [addExerciseId, setAddExerciseId] = useState<number | "">("");

  // local edits
  const [sets, setSets] = useState<Record<string, number | "">>({});
  const [reps, setReps] = useState<Record<string, number | "">>({});
  const [loads, setLoads] = useState<Record<string, number | "" | null>>({});
  const [durSec, setDurSec] = useState<Record<string, number | "">>({});

  // row-level reps validation state (only strength)
  const [repErr, setRepErr] = useState<Record<string, string>>({});

  // duration stored on session
  const [durationMin, setDurationMin] = useState<number>(60);

  // stable session_start (refresh-safe)
  const SESSION_KEY = `gym.session_start.${todayIso()}`;
  const LEGACY_SESSION_KEYS = ["gym_session_start_iso", "gym_session_start"];
  const [sessionStart, setSessionStart] = useState<string>("");

  // autosave debounce
  const saveTimersRef = useRef<Record<string, any>>({});

  const filteredAddExercises = useMemo(() => {
    const q = addExerciseQuery.trim().toLowerCase();
    if (!q) return exerciseList;
    return exerciseList.filter((e) => e.canonical_name.toLowerCase().includes(q));
  }, [addExerciseQuery, exerciseList]);

  const getPlanId = async (): Promise<number | null> => {
    const plan_date = todayIso();

    // v_today_plan_app usually has plan rows; we just need plan_id from workout_plan
    // If you have a person_id-based plan table, adjust here.
    const { data, error } = await supabase
      .from("workout_plan")
      .select("plan_id")
      .eq("plan_date", plan_date)
      .order("plan_id", { ascending: false })
      .limit(1);

    if (error) {
      setMsg(error.message);
      return null;
    }

    return data?.[0]?.plan_id ?? null;
  };

  const fetchLastVals = async (exercise_id: number): Promise<LastVals | null> => {
    const { data, error } = await supabase
      .from("v_last_exercise_values")
      .select("exercise_id, last_sets, last_reps, last_load_kg, last_session_start")
      .eq("exercise_id", exercise_id)
      .maybeSingle();

    if (error) return null;
    return (data as LastVals) ?? null;
  };

  const queueAutosave = (sequence_no: number, patch: Record<string, any>) => {
    void (async () => {
      const plan_id = await getPlanId();
      if (!plan_id) return;

      const key = `${plan_id}-${sequence_no}`;

      if (saveTimersRef.current[key]) clearTimeout(saveTimersRef.current[key]);

      saveTimersRef.current[key] = setTimeout(async () => {
        const { error } = await supabase
          .from("workout_plan_item")
          .update(patch)
          .eq("plan_id", plan_id)
          .eq("sequence_no", sequence_no);

        if (error) setMsg(error.message);
      }, 500);
    })();
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

    // session_start: read current key OR legacy keys, then migrate to current key
    const existing =
      window.localStorage.getItem(SESSION_KEY) ||
      LEGACY_SESSION_KEYS.map((k) => window.localStorage.getItem(k)).find(Boolean) ||
      "";

    if (existing) window.localStorage.setItem(SESSION_KEY, existing);
    setSessionStart(existing);

    setLoading(false);
  };

  // auth session
  useEffect(() => {
    if (typeof window === "undefined") return;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      setIsAuthed(!!data.session);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(!!session);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  // initial load
  useEffect(() => {
    if (typeof window === "undefined") return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when plan rows arrive, ensure local defaults exist (and pull last vals if plan targets are missing)
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

        const planSets = r.target_sets ?? undefined;
        const planReps = r.target_reps ?? undefined;
        const planLoad = (r.target_load_kg ?? r.suggested_load_kg) ?? undefined;

        const lastReps = lv?.last_reps ?? null;
        const safePlanReps = typeof planReps === "number" && isValidReps(planReps) ? planReps : null;
        const safeLastReps = typeof lastReps === "number" && isValidReps(lastReps) ? lastReps : null;

        nextSets[k] = planSets ?? lv?.last_sets ?? 3;
        nextReps[k] = safePlanReps ?? safeLastReps ?? 10;
        nextLoads[k] = planLoad ?? lv?.last_load_kg ?? null;
      }

      // only apply where user hasn't edited yet
      setSets((p) => ({ ...nextSets, ...p }));
      setReps((p) => ({ ...nextReps, ...p }));
      setLoads((p) => ({ ...nextLoads, ...p }));
      setDurSec((p) => ({ ...nextDur, ...p }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const signInMagicLink = async () => {
    setMsg("");
    if (!email.trim()) {
      setMsg("Enter an email first.");
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) setMsg(error.message);
    else setMsg("Magic link sent. Check your email.");
  };

  const startNewSession = () => {
    const ss = new Date().toISOString();
    window.localStorage.setItem(SESSION_KEY, ss);
    setSessionStart(ss);
    setMsg("New session started.");
  };

  const refreshPlan = async () => {
    setMsg("");
    const plan_date = todayIso();

    // you have a wrapper function public.generate_plan(p_days int, p_start_date date)
    // but for today it's best to call generate_plan_days directly if you want.
    // We'll just regen today via generate_plan_days( today, 1, 10 ) if it exists,
    // otherwise call generate_plan(p_plan_date,...).
    const { error } = await supabase.rpc("generate_plan", {
      p_days: 1,
      p_start_date: plan_date,
    });

    if (error) {
      // fallback to older signature
      const fb = await supabase.rpc("generate_plan", {
        p_plan_date: plan_date,
        p_cooldown_days: 10,
      });
      if (fb.error) setMsg(fb.error.message);
    }

    await loadAll();
  };

  const replaceExercise = async (sequence_no: number, new_exercise_id: number) => {
    setMsg("");

    const plan_id = await getPlanId();
    if (!plan_id) return;

    const plan_date = todayIso();
    const k = rowKey(plan_date, sequence_no);

    const newEx = exerciseList.find((e) => e.exercise_id === new_exercise_id);
    if (!newEx) return;

    // build a safe patch that satisfies NOT NULL constraints
    if (newEx.exercise_type === 2) {
      const duration = Number(durSec[k] === "" || durSec[k] == null ? 2400 : durSec[k]);
      const patch = {
        exercise_id: new_exercise_id,
        target_sets: 0,
        target_reps: 0,
        target_load_kg: null,
        target_duration_sec: Number.isFinite(duration) ? duration : 2400,
      };

      const { error } = await supabase
        .from("workout_plan_item")
        .update(patch)
        .eq("plan_id", plan_id)
        .eq("sequence_no", sequence_no);

      if (error) {
        setMsg(error.message);
        return;
      }

      // clear local strength edits for this slot
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
      setRepErr((p) => {
        const n = { ...p };
        delete n[k];
        return n;
      });

      setDurSec((p) => ({ ...p, [k]: patch.target_duration_sec }));
      await loadAll();
      return;
    }

    // strength
    const lv = await fetchLastVals(new_exercise_id);
    const nextSets = lv?.last_sets ?? 3;

    const lr = lv?.last_reps ?? 10;
    const nextReps = isValidReps(lr) ? lr : 10;

    const nextLoad = lv?.last_load_kg ?? null;

    const patch = {
      exercise_id: new_exercise_id,
      target_sets: nextSets,
      target_reps: nextReps,
      target_load_kg: nextLoad,
      target_duration_sec: 0,
    };

    const { error } = await supabase
      .from("workout_plan_item")
      .update(patch)
      .eq("plan_id", plan_id)
      .eq("sequence_no", sequence_no);

    if (error) {
      setMsg(error.message);
      return;
    }

    // clear local edits so we don't keep old exercise's values
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
    setRepErr((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });

    // apply immediately
    setSets((p) => ({ ...p, [k]: nextSets }));
    setReps((p) => ({ ...p, [k]: nextReps }));
    setLoads((p) => ({ ...p, [k]: nextLoad ?? "" }));

    await loadAll();
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

    if (error) setMsg(error.message);
    else await loadAll();
  };

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
      const lr = lv?.last_reps ?? 10;
      const target_reps = isValidReps(lr) ? lr : 10;
      const target_load_kg = lv?.last_load_kg ?? null;

      const { error } = await supabase.from("workout_plan_item").insert({
        plan_id,
        sequence_no,
        exercise_id: ex.exercise_id,
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
      // cardio: keep NOT NULL fields safe
      const { error } = await supabase.from("workout_plan_item").insert({
        plan_id,
        sequence_no,
        exercise_id: ex.exercise_id,
        target_sets: 0,
        target_reps: 0,
        target_load_kg: null,
        target_duration_sec: 2400,
      });

      if (error) {
        setMsg(error.message);
        return;
      }

      // set local duration so UI shows minutes immediately
      setDurSec((p) => ({ ...p, [rowKey(plan_date, sequence_no)]: 2400 }));
    }

    setAddExerciseId("");
    setAddExerciseQuery("");
    await loadAll();
  };

  const saveSession = async () => {
    setMsg("");

    // auto-start if missing (prevents dead-end)
    let ss = sessionStart;
    if (!ss) {
      ss = new Date().toISOString();
      window.localStorage.setItem(SESSION_KEY, ss);
      setSessionStart(ss);
    }

    const payload: RowPayload[] = [];

    for (const r of rows) {
      const k = rowKey(r.plan_date, r.sequence_no);

      if (r.exercise_type === 2) {
        const dRaw =
          durSec[k] === "" || durSec[k] == null ? r.target_duration_sec ?? 2400 : Number(durSec[k]);
        const duration_sec = Number.isFinite(dRaw) ? dRaw : 2400;
        payload.push({ sequence_no: r.sequence_no, name: r.exercise_name, duration_sec });
        continue;
      }

      const setCountRaw = sets[k] === "" || sets[k] == null ? r.target_sets ?? 3 : Number(sets[k]);
      const setCount = Number.isFinite(setCountRaw) && setCountRaw > 0 ? setCountRaw : 3;

      const repRaw = reps[k] === "" || reps[k] == null ? r.target_reps ?? 10 : Number(reps[k]);
      if (!isValidReps(repRaw)) {
        setMsg(`Reps out of range for "${r.exercise_name}" (must be ${REP_MIN}-${REP_MAX}).`);
        return;
      }

      const loadRaw =
        loads[k] === "" || loads[k] == null
          ? (r.target_load_kg ?? r.suggested_load_kg) ?? null
          : Number(loads[k]);

      const load_kg = Number.isFinite(loadRaw as number) ? (loadRaw as number) : null;

      const setsArr: StrengthSet[] = Array.from({ length: setCount }, () => ({
        reps: repRaw,
        load_kg,
      }));

      payload.push({ sequence_no: r.sequence_no, name: r.exercise_name, sets: setsArr });
    }

    const { error } = await supabase.rpc("log_session_json", {
      p_session_start: ss,
      p_duration_min: durationMin,
      p_rows: payload,
    });

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Saved.");
  };

  if (!isAuthed) {
    return (
      <div style={{ padding: 16, maxWidth: 720 }}>
        <h2 style={{ margin: 0 }}>Log session</h2>
        <p style={{ marginTop: 10 }}>Sign in (magic link) to use the log page.</p>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ padding: 10, width: 280 }}
          />
          <button onClick={signInMagicLink} style={{ padding: "10px 14px" }}>
            Send link
          </button>
        </div>

        {msg && <p style={{ color: "crimson", marginTop: 12 }}>{msg}</p>}
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ margin: 0, marginRight: 10 }}>Log session</h2>

        <button onClick={refreshPlan} style={{ padding: "8px 12px" }}>
          Refresh plan
        </button>
        <button onClick={loadAll} style={{ padding: "8px 12px" }}>
          Reload
        </button>

        <button onClick={startNewSession} style={{ padding: "8px 12px" }}>
          New session
        </button>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Duration (min)
          <input
            type="number"
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
            style={{ width: 90, padding: 6 }}
          />
        </label>

        <button onClick={saveSession} style={{ padding: "8px 12px" }}>
          Save session
        </button>
      </div>

      {/* Add exercise */}
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
            {filteredAddExercises.map((e) => (
              <option key={e.exercise_id} value={e.exercise_id}>
                {e.canonical_name}
              </option>
            ))}
          </select>
        </div>

        <button onClick={addExercise} style={{ padding: "10px 14px", height: 42 }}>
          Add
        </button>
      </div>

      {msg && <p style={{ color: msg === "Saved." ? "green" : "crimson" }}>{msg}</p>}
      {loading && <p>Loading…</p>}

      {!loading && rows.length === 0 && <p>No plan rows for today.</p>}

      {!loading && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => {
            const k = rowKey(r.plan_date, r.sequence_no);
            const isCardio = r.exercise_type === 2;

            return (
              <div
                key={k}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 600 }}>
                    {r.sequence_no}. {r.exercise_name}
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      value={r.exercise_id ?? ""}
                      onChange={(e) => replaceExercise(r.sequence_no, Number(e.target.value))}
                      style={{ padding: 8 }}
                    >
                      {exerciseList.map((e) => (
                        <option key={e.exercise_id} value={e.exercise_id}>
                          {e.canonical_name}
                        </option>
                      ))}
                    </select>

                    <button onClick={() => removeExercise(r.sequence_no)} style={{ padding: "8px 10px" }}>
                      Remove
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                  {isCardio ? (
                    <>
                      <div>
                        Target:{" "}
                        <strong>{Math.round(((durSec[k] as number) ?? r.target_duration_sec ?? 2400) / 60)} min</strong>
                      </div>

                      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        Duration (sec)
                        <input
                          type="number"
                          value={durSec[k] ?? ""}
                          onChange={(e) => {
                            const sec = e.target.value === "" ? "" : Number(e.target.value);
                            setDurSec((prev) => ({ ...prev, [k]: sec }));
                            if (sec !== "") queueAutosave(r.sequence_no, { target_duration_sec: sec });
                          }}
                          style={{ width: 90, padding: 6 }}
                        />
                      </label>
                    </>
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

                            if (v === "") {
                              setRepErr((p) => {
                                const n = { ...p };
                                delete n[k];
                                return n;
                              });
                              return;
                            }

                            if (isValidReps(v)) {
                              setRepErr((p) => {
                                const n = { ...p };
                                delete n[k];
                                return n;
                              });
                              queueAutosave(r.sequence_no, { target_reps: v });
                            } else {
                              setRepErr((p) => ({ ...p, [k]: `${REP_MIN}-${REP_MAX} only` }));
                            }
                          }}
                          style={{ width: 80, padding: 6 }}
                        />
                      </label>
                      {repErr[k] && <span style={{ color: "crimson", fontSize: 12 }}>{repErr[k]}</span>}

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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Mode = "plan" | "adhoc";

type PlanRowFromView = {
  plan_date: string;
  sequence_no: number;
  exercise_id: number | null;
  exercise_name: string;
  exercise_type: number; // 1 strength, 2 cardio
  target_sets: number | null;
  target_reps: number | null;
  target_duration_sec: number | null;
  suggested_load_kg: number | null;
  target_load_kg: number | null;
};

type Exercise = {
  exercise_id: number;
  canonical_name: string;
  exercise_type: number; // 1 strength, 2 cardio
  is_manual_only: boolean;
  is_distance_based: boolean;
  is_active: boolean;
};

type Row = {
  source: Mode;
  plan_date: string;
  sequence_no: number;
  exercise_id: number | null;
  exercise_name: string;
  exercise_type: number; // 1 or 2
  target_sets: number | null;
  target_reps: number | null;
  target_duration_sec: number | null;
  suggested_load_kg: number | null;
  target_load_kg: number | null;
};

type StrengthSet = { reps: number; load_kg: number | null };
type CardioSet = { duration_sec: number; calories_kcal?: number | null };

type RowPayload =
  | { sequence_no: number; kind: "strength"; name: string; sets: StrengthSet[] }
  | { sequence_no: number; kind: "cardio"; name: string; sets: CardioSet[] };

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

const todayIso = () => new Date().toISOString().slice(0, 10);
const rowKey = (planDate: string, seq: number) => `${planDate}-${seq}`;
const normName = (s: string) => (s ?? "").trim().toLowerCase();

function parseNumberOrBlank(v: string): number | "" {
  if (v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

function parseDecimalOrNull(v: string): number | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100; // 2dp
}

function asIntOrNull(v: number | "" | null | undefined): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

const clampReps = (v: number) => Math.max(REP_MIN, Math.min(REP_MAX, Math.round(v)));
const isValidReps = (v: number) => Number.isFinite(v) && v >= REP_MIN && v <= REP_MAX;

export default function LogPage() {
  const [mode, setMode] = useState<Mode>("plan");

  const [email, setEmail] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [exerciseList, setExerciseList] = useState<Exercise[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);

  const [msg, setMsg] = useState("");

  const [sessionStart, setSessionStart] = useState("");
  const [sessionDurationMin, setSessionDurationMin] = useState<number>(60);

  const autosaveTimers = useRef<Record<string, any>>({});

  const [sets, setSets] = useState<Record<string, number | "">>({});
  const [reps, setReps] = useState<Record<string, number | "">>({});
  // IMPORTANT: keep loads as strings so decimals don't get collapsed while typing
  const [loads, setLoads] = useState<Record<string, string>>({});
  const [durationsMin, setDurationsMin] = useState<Record<string, number | "">>({});
  const [caloriesKcal, setCaloriesKcal] = useState<Record<string, number | "">>({});

  const [addExerciseId, setAddExerciseId] = useState<number | "">("");
  const [addExerciseQuery, setAddExerciseQuery] = useState("");

  const [swapPick, setSwapPick] = useState<Record<string, number | "">>({});

  const signInMagicLink = async () => {
    setMsg("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    });

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
      .select("exercise_id, canonical_name, exercise_type, is_manual_only, is_distance_based, is_active")
      .eq("is_active", true)
      .order("canonical_name", { ascending: true });

    if (error) {
      setMsg(error.message);
      setExerciseList([]);
      return;
    }

    const list = ((data as any[]) ?? []).map<Exercise>((r) => ({
      exercise_id: Number(r.exercise_id),
      canonical_name: String(r.canonical_name),
      exercise_type: Number(r.exercise_type),
      is_manual_only: !!r.is_manual_only,
      is_distance_based: !!r.is_distance_based,
      is_active: !!r.is_active,
    }));
    setExerciseList(list);
  };

  const exerciseById = useMemo(() => {
    const m = new Map<number, Exercise>();
    for (const e of exerciseList) m.set(e.exercise_id, e);
    return m;
  }, [exerciseList]);

  const exerciseByName = useMemo(() => {
    const m = new Map<string, Exercise>();
    for (const e of exerciseList) m.set(normName(e.canonical_name), e);
    return m;
  }, [exerciseList]);

  const isDistanceBasedRow = (r: Row) => {
    if (r.exercise_type !== 2) return false;

    if (r.exercise_id != null) return !!exerciseById.get(r.exercise_id)?.is_distance_based;

    const byName = exerciseByName.get(normName(r.exercise_name));
    return !!byName?.is_distance_based;
  };

  const getPersonId = async (): Promise<number | null> => {
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

  const getRowDefaultLoad = (r: Row) => {
    if (r.target_load_kg != null) return Number(r.target_load_kg);
    return r.suggested_load_kg ?? null;
  };

  const clearLocalEditsForKey = (k: string) => {
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
    setCaloriesKcal((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });
    setSwapPick((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });
  };

  const loadTodayPlanRows = async () => {
    setMsg("");
    const planDate = todayIso();

    const { data, error } = await supabase
      .from("v_plan_today_edit")
      .select("*")
      .eq("plan_date", planDate)
      .order("sequence_no", { ascending: true });

    if (error) {
      setMsg(error.message);
      return;
    }

    const src = ((data as PlanRowFromView[]) ?? []).map<Row>((r) => {
      const recoveredId = r.exercise_id ?? exerciseByName.get(normName(r.exercise_name))?.exercise_id ?? null;
      return {
        source: "plan",
        plan_date: planDate,
        sequence_no: r.sequence_no,
        exercise_id: recoveredId,
        exercise_name: r.exercise_name,
        exercise_type: r.exercise_type,
        target_sets: r.target_sets,
        target_reps: r.target_reps,
        target_duration_sec: r.target_duration_sec,
        suggested_load_kg: r.suggested_load_kg,
        target_load_kg: r.target_load_kg ?? null,
      };
    });

    setRows(src);
    setMode("plan");
    void loadPlanIdForToday();

    const nextSets: Record<string, number | ""> = {};
    const nextReps: Record<string, number | ""> = {};
    const nextLoads: Record<string, string> = {};
    const nextDurMin: Record<string, number | ""> = {};
    const nextCal: Record<string, number | ""> = {};

    for (const row of src) {
      const k = rowKey(planDate, row.sequence_no);
      if (row.exercise_type === 1) {
        nextSets[k] = row.target_sets ?? 3;
        nextReps[k] = row.target_reps ?? 10;
        const d = getRowDefaultLoad(row);
        nextLoads[k] = d == null ? "" : String(d);
      } else {
        const mins = row.target_duration_sec != null ? Math.round(row.target_duration_sec / 60) : 0;
        nextDurMin[k] = mins;
        if (isDistanceBasedRow(row)) nextCal[k] = "";
      }
    }

    setSets(nextSets);
    setReps(nextReps);
    setLoads(nextLoads);
    setDurationsMin(nextDurMin);
    setCaloriesKcal(nextCal);
  };

  const startAdhocWorkout = () => {
    setMsg("Ad-hoc workout: add exercises below.");
    setMode("adhoc");
    setRows([]);
    setPlanId(null);
    setSets({});
    setReps({});
    setLoads({});
    setDurationsMin({});
    setCaloriesKcal({});
    setSwapPick({});
  };

  const refreshPlan = async () => {
    setMsg("");
    const { error } = await supabase.rpc("generate_plan", {
      p_days: 1,
      p_start_date: todayIso(),
    });
    if (error) return setMsg(error.message);

    await loadTodayPlanRows();
    setMsg("Plan refreshed.");
  };

  const queueAutosave = (sequence_no: number, patch: PlanItemPatch) => {
    if (mode !== "plan") return;

    const planDate = todayIso();
    const k = rowKey(planDate, sequence_no);

    if (autosaveTimers.current[k]) clearTimeout(autosaveTimers.current[k]);

    autosaveTimers.current[k] = setTimeout(async () => {
      autosaveTimers.current[k] = null;

      const pid = await requirePlanId();
      if (!pid) return setMsg("No plan loaded. Click Refresh plan.");

      const { error } = await supabase
        .from("workout_plan_item")
        .update(patch)
        .eq("plan_id", pid)
        .eq("sequence_no", sequence_no);

      if (error) setMsg(error.message);
    }, 500);
  };

  const addExercise = async () => {
    setMsg("");
    if (addExerciseId === "") return;

    const ex = exerciseById.get(Number(addExerciseId));
    if (!ex) return;

    const planDate = todayIso();
    const maxSeq = rows.reduce((m, r) => Math.max(m, r.sequence_no), 0);
    const newSeq = maxSeq > 0 ? maxSeq + 10 : 10;
    const k = rowKey(planDate, newSeq);

    if (mode === "adhoc") {
      setRows((prev) => [
        ...prev,
        {
          source: "adhoc",
          plan_date: planDate,
          sequence_no: newSeq,
          exercise_id: ex.exercise_id,
          exercise_name: ex.canonical_name,
          exercise_type: ex.exercise_type,
          target_sets: ex.exercise_type === 1 ? 3 : null,
          target_reps: ex.exercise_type === 1 ? 10 : null,
          target_duration_sec: ex.exercise_type === 2 ? 8 * 60 : null,
          suggested_load_kg: null,
          target_load_kg: null,
        },
      ]);

      if (ex.exercise_type === 1) {
        setSets((p) => ({ ...p, [k]: 3 }));
        setReps((p) => ({ ...p, [k]: 10 }));
        setLoads((p) => ({ ...p, [k]: "" }));
      } else {
        setDurationsMin((p) => ({ ...p, [k]: 8 }));
        if (ex.is_distance_based) setCaloriesKcal((p) => ({ ...p, [k]: "" }));
      }

      setAddExerciseId("");
      setMsg("Added (ad-hoc).");
      return;
    }

    const pid = await requirePlanId();
    if (!pid) return setMsg("No plan loaded. Click Refresh plan.");

    const insertRow: any = {
      plan_id: pid,
      sequence_no: newSeq,
      exercise_id: ex.exercise_id,
      target_sets: 3,
      target_reps: 10,
      target_load_kg: null,
      target_duration_sec: null,
    };
    if (ex.exercise_type === 2) insertRow.target_duration_sec = 8 * 60;

    const { error } = await supabase.from("workout_plan_item").insert(insertRow);
    if (error) return setMsg(error.message);

    setAddExerciseId("");
    await loadTodayPlanRows();
    setMsg("Exercise added.");
  };

  const removeRow = async (sequence_no: number) => {
    setMsg("");
    const k = rowKey(todayIso(), sequence_no);

    if (mode === "adhoc") {
      setRows((prev) => prev.filter((r) => r.sequence_no !== sequence_no));
      clearLocalEditsForKey(k);
      setMsg("Removed.");
      return;
    }

    const pid = await requirePlanId();
    if (!pid) return setMsg("No plan loaded. Click Refresh plan.");

    const { error } = await supabase.from("workout_plan_item").delete().eq("plan_id", pid).eq("sequence_no", sequence_no);
    if (error) return setMsg(error.message);

    await loadTodayPlanRows();
    setMsg("Removed.");
  };

  const replaceExercise = async (sequence_no: number, newExerciseId: number) => {
    setMsg("");
    const k = rowKey(todayIso(), sequence_no);

    const ex = exerciseById.get(newExerciseId);
    if (!ex) return;

    if (mode === "adhoc") {
      setRows((prev) =>
        prev.map((r) =>
          r.sequence_no === sequence_no
            ? {
                ...r,
                exercise_id: ex.exercise_id,
                exercise_name: ex.canonical_name,
                exercise_type: ex.exercise_type,
                target_sets: ex.exercise_type === 1 ? 3 : null,
                target_reps: ex.exercise_type === 1 ? 10 : null,
                target_duration_sec: ex.exercise_type === 2 ? 8 * 60 : null,
              }
            : r
        )
      );
      clearLocalEditsForKey(k);
      if (ex.exercise_type === 1) setLoads((p) => ({ ...p, [k]: "" }));
      if (ex.exercise_type === 2 && ex.is_distance_based) setCaloriesKcal((p) => ({ ...p, [k]: "" }));
      setMsg("Swapped.");
      return;
    }

    const pid = await requirePlanId();
    if (!pid) return setMsg("No plan loaded. Click Refresh plan.");

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

    if (error) setMsg(error.message);

    clearLocalEditsForKey(k);
    await loadTodayPlanRows();
    setMsg("Swapped.");
  };

  const payload: RowPayload[] = useMemo(() => {
    const planDate = todayIso();
    const out: RowPayload[] = [];

    for (const r of rows) {
      const k = rowKey(planDate, r.sequence_no);

      if (r.exercise_type === 2) {
        const defaultMins = Math.round((r.target_duration_sec ?? 0) / 60);
        const mins = (durationsMin[k] ?? defaultMins) as number | "";
        const minutes = mins === "" ? defaultMins : Number(mins);
        const duration_sec = Math.max(0, Math.round(minutes * 60));

        const cardioSet: CardioSet = { duration_sec };
        if (isDistanceBasedRow(r)) cardioSet.calories_kcal = asIntOrNull(caloriesKcal[k] ?? "");

        out.push({ sequence_no: r.sequence_no, kind: "cardio", name: r.exercise_name, sets: [cardioSet] });
        continue;
      }

      const defaultSets = r.target_sets ?? 3;
      const defaultReps = r.target_reps ?? 10;
      const defaultLoad = getRowDefaultLoad(r);

      const setCount = (sets[k] ?? defaultSets) as number | "";
      const repsVal = (reps[k] ?? defaultReps) as number | "";

      const s = setCount === "" ? defaultSets : Number(setCount);
      const repNum = repsVal === "" ? defaultReps : Number(repsVal);
      const rep = clampReps(repNum);

      const loadText = loads[k] ?? (defaultLoad == null ? "" : String(defaultLoad));
      const load_kg = parseDecimalOrNull(loadText);

      const setsArr: StrengthSet[] = [];
      for (let i = 0; i < Math.max(1, Math.round(s)); i++) setsArr.push({ reps: rep, load_kg });

      out.push({ sequence_no: r.sequence_no, kind: "strength", name: r.exercise_name, sets: setsArr });
    }

    return out;
  }, [rows, sets, reps, loads, durationsMin, caloriesKcal, exerciseById, exerciseByName]);

  const saveSession = async () => {
    setMsg("");

    let ss = sessionStart;
    if (!ss) ss = ensureSessionStart();

    for (const r of rows) {
      if (r.exercise_type !== 1) continue;
      const k = rowKey(todayIso(), r.sequence_no);
      const defaultReps = r.target_reps ?? 10;
      const repRaw = reps[k] ?? defaultReps;
      const repNum = repRaw === "" ? defaultReps : Number(repRaw);
      if (!isValidReps(repNum)) return setMsg(`Reps out of range for "${r.exercise_name}" (${REP_MIN}-${REP_MAX}).`);
    }

    const { error } = await supabase.rpc("log_session_json", {
      p_session_start: ss,
      p_duration_min: sessionDurationMin,
      p_rows: payload,
    });

    setMsg(error ? error.message : "Session saved.");
  };

  // HARDENED AUTH INIT: never hang on "Checking sign-in…"
  useEffect(() => {
    let mounted = true;

    const safeEnsureSessionStart = () => {
      try {
        ensureSessionStart();
      } catch (e) {
        console.error("ensureSessionStart failed", e);
      }
    };

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;

        if (error) console.error("getSession error", error);

        const authed = !!data?.session;
        setIsAuthed(authed);
        setAuthReady(true);

        if (authed) safeEnsureSessionStart();
      } catch (e) {
        console.error("getSession threw", e);
        if (!mounted) return;
        setIsAuthed(false);
        setAuthReady(true);
        setMsg("Auth check failed (see console).");
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!mounted) return;

      setIsAuthed(!!session);
      setAuthReady(true);

      if (session) safeEnsureSessionStart();
      else setRows([]);
    });

    const t = setTimeout(() => {
      if (!mounted) return;
      setAuthReady(true);
    }, 1500);

    return () => {
      mounted = false;
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    (async () => {
      await loadExerciseList();
      await loadTodayPlanRows();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  const filteredAddExercises = useMemo(() => {
    const q = addExerciseQuery.trim().toLowerCase();
    if (!q) return exerciseList;
    return exerciseList.filter((e) => e.canonical_name.toLowerCase().includes(q));
  }, [exerciseList, addExerciseQuery]);

  const th: React.CSSProperties = { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #333" };
  const td: React.CSSProperties = { padding: "10px 8px", borderBottom: "1px solid #222", verticalAlign: "top" };

  if (!authReady) {
    return (
      <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
        <h1>Log session</h1>
        <p>Checking sign-in…</p>
      </main>
    );
  }

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
        Date: <b>{todayIso()}</b> · Mode: <b>{mode === "plan" ? "Plan" : "Ad-hoc"}</b> · Plan ID:{" "}
        <b>{planId ?? "(none)"}</b> · Session start: <b>{sessionStart || "(not set)"}</b>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <button onClick={loadTodayPlanRows} style={{ padding: "10px 14px" }}>
          Load Today&apos;s Plan
        </button>
        <button onClick={startAdhocWorkout} style={{ padding: "10px 14px" }}>
          New Ad-hoc Workout
        </button>
        <button onClick={refreshPlan} style={{ padding: "10px 14px" }}>
          Refresh plan
        </button>
        <button onClick={newSession} style={{ padding: "10px 14px" }}>
          New session
        </button>

        <label style={{ marginLeft: 6 }}>
          Duration (min):{" "}
          <input
            type="text"
            inputMode="numeric"
            value={String(sessionDurationMin)}
            onChange={(e) => {
              const v = parseNumberOrBlank(e.target.value);
              setSessionDurationMin(v === "" ? 0 : Math.max(0, Math.round(v)));
            }}
            style={{ width: 90, padding: 6 }}
          />
        </label>

        <button onClick={saveSession} style={{ padding: "10px 14px", marginLeft: 6 }}>
          Save session
        </button>
      </div>

      {msg && <div style={{ marginBottom: 14 }}>{msg}</div>}

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
          {filteredAddExercises.map((e) => (
            <option key={e.exercise_id} value={e.exercise_id}>
              {e.canonical_name}
              {e.is_manual_only ? " (manual)" : ""}
              {e.is_distance_based ? " (distance)" : ""}
            </option>
          ))}
        </select>

        <button onClick={addExercise} style={{ padding: "10px 14px" }}>
          Add
        </button>
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
              const k = rowKey(todayIso(), r.sequence_no);

              const showSets = (sets[k] ?? (r.target_sets ?? 3)) as number | "";
              const showReps = (reps[k] ?? (r.target_reps ?? 10)) as number | "";

              const defaultLoad = getRowDefaultLoad(r);
              const showLoad = loads[k] ?? (defaultLoad == null ? "" : String(defaultLoad));

              const targetMin = r.target_duration_sec != null ? Math.round(r.target_duration_sec / 60) : 0;
              const showMin = (durationsMin[k] ?? targetMin) as number | "";

              const showCalories = (caloriesKcal[k] ?? "") as number | "";
              const showCaloriesField = isDistanceBasedRow(r);

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
                            type="text"
                            inputMode="numeric"
                            value={showReps === "" ? "" : String(showReps)}
                            onChange={(e) => {
                              const raw = parseNumberOrBlank(e.target.value);
                              setReps((prev) => ({ ...prev, [k]: raw }));
                              if (raw !== "" && mode === "plan")
                                queueAutosave(r.sequence_no, { target_reps: clampReps(raw) });
                            }}
                            style={{ width: 90, marginLeft: 6, padding: 6 }}
                          />
                        </label>

                        <label>
                          Load (kg):
                          <input
                            type="text"
                            inputMode="decimal"
                            value={showLoad}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setLoads((prev) => ({ ...prev, [k]: raw }));
                              if (mode === "plan")
                                queueAutosave(r.sequence_no, { target_load_kg: parseDecimalOrNull(raw) });
                            }}
                            style={{ width: 110, marginLeft: 6, padding: 6 }}
                          />
                        </label>

                        <label>
                          Sets:
                          <input
                            type="text"
                            inputMode="numeric"
                            value={showSets === "" ? "" : String(showSets)}
                            onChange={(e) => {
                              const v = parseNumberOrBlank(e.target.value);
                              setSets((prev) => ({ ...prev, [k]: v }));
                              if (v !== "" && mode === "plan")
                                queueAutosave(r.sequence_no, { target_sets: Math.max(1, Math.round(v)) });
                            }}
                            style={{ width: 70, marginLeft: 6, padding: 6 }}
                          />
                        </label>
                      </div>
                    )}

                    {r.exercise_type === 2 && (
                      <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <div>
                          Target: <b>{targetMin} min</b>
                        </div>

                        <label>
                          Duration (min):
                          <input
                            type="text"
                            inputMode="numeric"
                            value={showMin === "" ? "" : String(showMin)}
                            onChange={(e) => {
                              const v = parseNumberOrBlank(e.target.value);
                              setDurationsMin((prev) => ({ ...prev, [k]: v }));
                              if (v !== "" && mode === "plan")
                                queueAutosave(r.sequence_no, { target_duration_sec: Math.max(0, Math.round(v * 60)) });
                              if (v === "" && mode === "plan") queueAutosave(r.sequence_no, { target_duration_sec: 0 });
                            }}
                            style={{ width: 90, marginLeft: 6, padding: 6 }}
                          />
                        </label>

                        {showCaloriesField && (
                          <label>
                            Calories (kcal):
                            <input
                              type="text"
                              inputMode="numeric"
                              value={showCalories === "" ? "" : String(showCalories)}
                              onChange={(e) => {
                                const v = parseNumberOrBlank(e.target.value);
                                setCaloriesKcal((prev) => ({ ...prev, [k]: v }));
                              }}
                              style={{ width: 120, marginLeft: 6, padding: 6 }}
                            />
                          </label>
                        )}
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
                        {exerciseList.map((e) => (
                          <option key={e.exercise_id} value={e.exercise_id}>
                            {e.canonical_name}
                            {e.is_manual_only ? " (manual)" : ""}
                            {e.is_distance_based ? " (distance)" : ""}
                          </option>
                        ))}
                      </select>

                      <button onClick={() => void removeRow(r.sequence_no)} style={{ padding: "10px 14px" }}>
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
                  No rows. Use <b>Add</b> to build your workout.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

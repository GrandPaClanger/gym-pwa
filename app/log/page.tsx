"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { installAuthRecovery, localSignOut } from "@/lib/authRecovery";
import { ExerciseGroup, readExerciseGroups } from "@/lib/exerciseGroups";

type Mode = "plan" | "adhoc";

type PlanRowFromView = {
  plan_date: string;
  sequence_no: number;
  exercise_id: number | null;
  exercise_name: string;
  exercise_type: number; // 1 strength, 2 cardio, 4 classes
  target_sets: number | null;
  target_reps: number | null;
  target_duration_sec: number | null;
  suggested_load_kg: number | null;
  target_load_kg: number | null;
  is_active: boolean;
};

type Exercise = {
  exercise_id: number;
  canonical_name: string;
  exercise_type: number; // 1 strength, 2 cardio, 4 classes
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
  exercise_type: number; // 1 strength, 2 cardio, 4 classes
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
const isCardioType = (exerciseType: number) => exerciseType === 2;
const isClassType = (exerciseType: number) => exerciseType === 4;
const isTimedType = (exerciseType: number) => isCardioType(exerciseType) || isClassType(exerciseType);
const isStrengthType = (exerciseType: number) => !isTimedType(exerciseType);
const defaultDurationMin = (exerciseType: number) => (isClassType(exerciseType) ? 60 : 8);
const typeLabel = (exerciseType: number) => (isClassType(exerciseType) ? "Class" : isCardioType(exerciseType) ? "Cardio" : "Strength");
const typeBadgeClass = (exerciseType: number) => (isClassType(exerciseType) ? "badge-purple" : isCardioType(exerciseType) ? "badge-green" : "badge-blue");
const targetSetsFor = (exerciseType: number) => (isStrengthType(exerciseType) ? 3 : 1);
const targetRepsFor = (exerciseType: number) => (isStrengthType(exerciseType) ? 10 : 1);

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
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("plan");

  const [email, setEmail] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [exerciseList, setExerciseList] = useState<Exercise[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [groups, setGroups] = useState<ExerciseGroup[]>([]);
  const [addGroupId, setAddGroupId] = useState("");

  const [msg, setMsg] = useState("");

  const [sessionStart, setSessionStart] = useState("");
  const [sessionDurationMin, setSessionDurationMin] = useState<number>(60);

  // Session notes (stored in Supabase per session_start)
  const [sessionNotes, setSessionNotes] = useState("");
  const [notesMsg, setNotesMsg] = useState("");
  const notesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  const [sets, setSets] = useState<Record<string, number | "">>({});
  const [reps, setReps] = useState<Record<string, number | "">>({});
  // IMPORTANT: keep loads as strings so decimals don't get collapsed while typing
  const [loads, setLoads] = useState<Record<string, string>>({});
  const [durationsMin, setDurationsMin] = useState<Record<string, number | "">>({});
  const [caloriesKcal, setCaloriesKcal] = useState<Record<string, number | "">>({});

  const [addExerciseId, setAddExerciseId] = useState<number | "">("");
  const [addExerciseQuery, setAddExerciseQuery] = useState("");

  const [swapPick, setSwapPick] = useState<Record<string, number | "">>({});

  // per-exercise quick notes (one per exercise_id, shown every time)
  const [exerciseNotes, setExerciseNotes] = useState<Record<number, string>>({});
  const [activeNoteExerciseId, setActiveNoteExerciseId] = useState<number | null>(null);
  const noteTimers = useRef<Record<number, ReturnType<typeof setTimeout> | null>>({});
  const [exNoteMsg, setExNoteMsg] = useState("");

  // max load stats: exercise_id -> { max_load_kg, times_at_max }
  const [maxLoadStats, setMaxLoadStats] = useState<Record<number, { max_load_kg: number; times_at_max: number }>>({});

  const [googleLoading, setGoogleLoading] = useState(false);

  const loadGroupsFromDb = async () => {
    const { groups: stored, error } = await readExerciseGroups(supabase);
    if (error) {
      setMsg(error);
      setGroups([]);
      setAddGroupId("");
      return;
    }
    setGroups(stored);
    setAddGroupId((current) =>
      current && stored.some((g) => g.id === current)
        ? current
        : stored[0]?.id ?? ""
    );
  };

  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setMsg(error.message); setGoogleLoading(false); }
  };

  const signInMagicLink = async () => {
    setMsg("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setMsg(error ? error.message : "Check your email for the magic link.");
  };

  const signOut = () => {
    setIsAuthed(false);
    setRows([]);
    setGroups([]);
    setAddGroupId("");
    setMsg("");
    void localSignOut();
    router.replace("/log");
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
    setSessionNotes("");
    setNotesMsg("");
    setMsg("New session started.");
  };

  const loadExerciseList = async (): Promise<Exercise[]> => {
    const { data, error } = await supabase
      .from("exercise")
      .select("exercise_id, canonical_name, exercise_type, is_manual_only, is_distance_based, is_active")
      .eq("is_active", true)
      .order("canonical_name", { ascending: true });

    if (error) {
      setMsg(error.message);
      setExerciseList([]);
      return [];
    }

    const list = ((data as Exercise[]) ?? []).map<Exercise>((r) => ({
      exercise_id: Number(r.exercise_id),
      canonical_name: String(r.canonical_name),
      exercise_type: Number(r.exercise_type),
      is_manual_only: !!r.is_manual_only,
      is_distance_based: !!r.is_distance_based,
      is_active: !!r.is_active,
    }));
    setExerciseList(list);
    return list;
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

  const isDistanceBasedRow = useCallback((r: Row) => {
    if (!isCardioType(r.exercise_type)) return false;

    if (r.exercise_id != null) return !!exerciseById.get(r.exercise_id)?.is_distance_based;

    const byName = exerciseByName.get(normName(r.exercise_name));
    return !!byName?.is_distance_based;
  }, [exerciseById, exerciseByName]);

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

    const id = (data as { plan_id: number }[])?.[0]?.plan_id;
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

  const loadTodayPlanRows = async (freshList?: Exercise[]) => {
    setMsg("");
    const planDate = todayIso();

    const { data, error } = await supabase
      .from("v_plan_today_edit")
      .select("*")
      .eq("plan_date", planDate)
      .eq("is_active", true)
      .order("sequence_no", { ascending: true });

    if (error) {
      setMsg(error.message);
      return;
    }

    // If a freshList is passed (on initial load), build the name map from it directly
    // so we don't rely on the stale exerciseByName memo before React re-renders.
    const nameMap = freshList
      ? new Map(freshList.map((e) => [normName(e.canonical_name), e]))
      : exerciseByName;

    const src = ((data as PlanRowFromView[]) ?? []).map<Row>((r) => {
      const recoveredId = r.exercise_id ?? nameMap.get(normName(r.exercise_name))?.exercise_id ?? null;
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
    void loadMaxLoadStats(src);

    const nextSets: Record<string, number | ""> = {};
    const nextReps: Record<string, number | ""> = {};
    const nextLoads: Record<string, string> = {};
    const nextDurMin: Record<string, number | ""> = {};
    const nextCal: Record<string, number | ""> = {};

    for (const row of src) {
      const k = rowKey(planDate, row.sequence_no);
      if (isStrengthType(row.exercise_type)) {
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
    await loadTodayPlanRows();
    setMsg("Plan reloaded.");
  };

  const queueAutosave = (sequence_no: number, patch: PlanItemPatch) => {
    if (mode !== "plan") return;

    const planDate = todayIso();
    const k = rowKey(planDate, sequence_no);

    if (autosaveTimers.current[k]) clearTimeout(autosaveTimers.current[k]!);

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
          target_sets: targetSetsFor(ex.exercise_type),
          target_reps: targetRepsFor(ex.exercise_type),
          target_duration_sec: isTimedType(ex.exercise_type) ? defaultDurationMin(ex.exercise_type) * 60 : null,
          suggested_load_kg: null,
          target_load_kg: null,
        },
      ]);

      if (isStrengthType(ex.exercise_type)) {
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

    const insertRow: {
      plan_id: number;
      sequence_no: number;
      exercise_id: number;
      target_sets: number;
      target_reps: number;
      target_load_kg: null;
      target_duration_sec: number | null;
    } = {
      plan_id: pid,
      sequence_no: newSeq,
      exercise_id: ex.exercise_id,
      target_sets: 3,
      target_reps: 10,
      target_load_kg: null,
      target_duration_sec: null,
    };
    if (isTimedType(ex.exercise_type)) insertRow.target_duration_sec = defaultDurationMin(ex.exercise_type) * 60;

    const { error } = await supabase.from("workout_plan_item").insert(insertRow);
    if (error) return setMsg(error.message);

    setAddExerciseId("");
    await loadTodayPlanRows();
    setMsg("Exercise added.");
  };

  const addExerciseGroup = async () => {
    setMsg("");
    const group = groups.find((g) => g.id === addGroupId);
    if (!group) return setMsg("Select an exercise group.");

    const groupExercises = group.exerciseIds
      .map((id) => exerciseById.get(id))
      .filter((e): e is Exercise => !!e);
    if (groupExercises.length === 0) return setMsg("That group has no active exercises.");

    const existingIds = new Set(rows.map((r) => r.exercise_id).filter((id): id is number => id != null));
    const toAdd = groupExercises.filter((e) => !existingIds.has(e.exercise_id));
    if (toAdd.length === 0) {
      return setMsg("All exercises in that group are already in this session.");
    }

    const planDate = todayIso();
    const maxSeq = rows.reduce((m, r) => Math.max(m, r.sequence_no), 0);

    if (mode === "adhoc") {
      const newRows = toAdd.map<Row>((ex, index) => ({
        source: "adhoc",
        plan_date: planDate,
        sequence_no: maxSeq + (index + 1) * 10,
        exercise_id: ex.exercise_id,
        exercise_name: ex.canonical_name,
        exercise_type: ex.exercise_type,
        target_sets: targetSetsFor(ex.exercise_type),
        target_reps: targetRepsFor(ex.exercise_type),
        target_duration_sec: isTimedType(ex.exercise_type) ? defaultDurationMin(ex.exercise_type) * 60 : null,
        suggested_load_kg: null,
        target_load_kg: null,
      }));

      setRows((prev) => [...prev, ...newRows]);
      setSets((prev) => {
        const next = { ...prev };
        for (const row of newRows) if (isStrengthType(row.exercise_type)) next[rowKey(planDate, row.sequence_no)] = 3;
        return next;
      });
      setReps((prev) => {
        const next = { ...prev };
        for (const row of newRows) if (isStrengthType(row.exercise_type)) next[rowKey(planDate, row.sequence_no)] = 10;
        return next;
      });
      setLoads((prev) => {
        const next = { ...prev };
        for (const row of newRows) if (isStrengthType(row.exercise_type)) next[rowKey(planDate, row.sequence_no)] = "";
        return next;
      });
      setDurationsMin((prev) => {
        const next = { ...prev };
        for (const row of newRows) if (isTimedType(row.exercise_type)) next[rowKey(planDate, row.sequence_no)] = defaultDurationMin(row.exercise_type);
        return next;
      });
      setCaloriesKcal((prev) => {
        const next = { ...prev };
        for (const row of newRows) {
          const ex = exerciseById.get(row.exercise_id ?? 0);
          if (isCardioType(row.exercise_type) && ex?.is_distance_based) next[rowKey(planDate, row.sequence_no)] = "";
        }
        return next;
      });

      const skipped = groupExercises.length - toAdd.length;
      setMsg(
        skipped > 0
          ? `Added ${toAdd.length} from "${group.name}" (${skipped} already present).`
          : `Added ${toAdd.length} from "${group.name}".`
      );
      return;
    }

    const pid = await requirePlanId();
    if (!pid) return setMsg("No plan loaded. Click Refresh plan.");

    const insertRows = toAdd.map((ex, index) => ({
      plan_id: pid,
      sequence_no: maxSeq + (index + 1) * 10,
      exercise_id: ex.exercise_id,
      target_sets: targetSetsFor(ex.exercise_type),
      target_reps: targetRepsFor(ex.exercise_type),
      target_load_kg: null,
      target_duration_sec: isTimedType(ex.exercise_type) ? defaultDurationMin(ex.exercise_type) * 60 : null,
    }));

    const { error } = await supabase.from("workout_plan_item").insert(insertRows);
    if (error) return setMsg(error.message);

    await loadTodayPlanRows();
    const skipped = groupExercises.length - toAdd.length;
    setMsg(
      skipped > 0
        ? `Added ${toAdd.length} from "${group.name}" (${skipped} already present).`
        : `Added ${toAdd.length} from "${group.name}".`
    );
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

    clearLocalEditsForKey(k);
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
                target_sets: targetSetsFor(ex.exercise_type),
                target_reps: targetRepsFor(ex.exercise_type),
                target_duration_sec: isTimedType(ex.exercise_type) ? defaultDurationMin(ex.exercise_type) * 60 : null,
              }
            : r
        )
      );
      clearLocalEditsForKey(k);
      if (isStrengthType(ex.exercise_type)) setLoads((p) => ({ ...p, [k]: "" }));
      if (isCardioType(ex.exercise_type) && ex.is_distance_based) setCaloriesKcal((p) => ({ ...p, [k]: "" }));
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
      target_duration_sec: isTimedType(ex.exercise_type) ? defaultDurationMin(ex.exercise_type) * 60 : null,
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

  // Session notes DB helpers
  const loadNotesFromDb = async (ss: string) => {
    setNotesMsg("");
    if (!ss) return;

    const { data, error } = await supabase
      .from("workout_session_note")
      .select("notes")
      .eq("session_start", ss)
      .maybeSingle();

    if (error) {
      setNotesMsg(error.message);
      setSessionNotes("");
      return;
    }

    setSessionNotes((data as { notes: string } | null)?.notes ?? "");
  };

  const saveNotesToDb = async (ss: string, notes: string) => {
    if (!ss) return;
    const { error } = await supabase
      .from("workout_session_note")
      .upsert({ session_start: ss, notes }, { onConflict: "user_id,session_start" });

    if (error) setNotesMsg(error.message);
    else setNotesMsg("Saved.");
  };

  // load per-exercise notes for this user/person
  const loadExerciseNotes = async () => {
    setExNoteMsg("");
    const { data, error } = await supabase.rpc("my_exercise_notes");
    if (error) {
      setExNoteMsg(error.message);
      return;
    }

    const m: Record<number, string> = {};
    for (const r of (data as { exercise_id: number; note: string }[]) ?? []) {
      const id = Number(r.exercise_id);
      if (!Number.isFinite(id)) continue;
      m[id] = String(r.note ?? "");
    }
    setExerciseNotes(m);
  };

  const loadMaxLoadStats = async (strengthRows: Row[]) => {
    const ids = strengthRows
      .filter((r) => isStrengthType(r.exercise_type) && r.exercise_id != null)
      .map((r) => r.exercise_id as number);
    if (ids.length === 0) return;

    const { data, error } = await supabase.rpc("my_exercise_max_load_stats", {
      p_exercise_ids: ids,
    });
    if (error) return;

    const m: Record<number, { max_load_kg: number; times_at_max: number }> = {};
    for (const row of (data as { exercise_id: number; max_load_kg: number; times_at_max: number }[]) ?? []) {
      m[Number(row.exercise_id)] = {
        max_load_kg: Number(row.max_load_kg),
        times_at_max: Number(row.times_at_max),
      };
    }
    setMaxLoadStats(m);
  };

  const queueSaveExerciseNote = (exercise_id: number, note: string) => {
    setExNoteMsg("");
    if (noteTimers.current[exercise_id]) clearTimeout(noteTimers.current[exercise_id]!);

    noteTimers.current[exercise_id] = setTimeout(async () => {
      noteTimers.current[exercise_id] = null;

      const trimmed = note.trim().slice(0, 30);
      const { error } = await supabase.rpc("set_exercise_note", {
        p_exercise_id: exercise_id,
        p_note: trimmed,
      });

      if (error) setExNoteMsg(error.message);
      else setExNoteMsg("Exercise note saved.");
    }, 500);
  };

  const payload: RowPayload[] = useMemo(() => {
    const planDate = todayIso();
    const out: RowPayload[] = [];

    for (const r of rows) {
      const k = rowKey(planDate, r.sequence_no);

      if (isTimedType(r.exercise_type)) {
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
  }, [rows, sets, reps, loads, durationsMin, caloriesKcal, isDistanceBasedRow]);

  const saveSession = async () => {
    setMsg("");

    let ss = sessionStart;
    if (!ss) ss = ensureSessionStart();

    for (const r of rows) {
      if (!isStrengthType(r.exercise_type)) continue;
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

    if (error) return setMsg(error.message);

    // ensure notes are persisted when you hit Save session
    await saveNotesToDb(ss, sessionNotes);

    setMsg("Session saved.");
  };

  // Auth init (hardened)
  useEffect(() => {
    let mounted = true;
    const removeAuthRecovery = installAuthRecovery(() => {
      if (!mounted) return;
      setIsAuthed(false);
      setRows([]);
      setGroups([]);
      setAddGroupId("");
    });

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
        if (data.session?.user.id) await loadGroupsFromDb();
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
      if (session?.user.id) {
        void loadGroupsFromDb().catch((error) => {
          console.error("Auth state group load failed", error);
          setMsg("Connection timed out. Please refresh or sign in again.");
        });
      }
      else {
        setGroups([]);
        setAddGroupId("");
      }
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
      removeAuthRecovery();
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    (async () => {
      try {
        const freshList = await loadExerciseList();
        await loadTodayPlanRows(freshList);
        const ss = ensureSessionStart();
        await loadNotesFromDb(ss);
        await loadExerciseNotes();
      } catch (error) {
        console.error("Log page load failed", error);
        setMsg("Connection timed out. Please refresh or sign in again.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  // whenever sessionStart changes, load notes for that session
  useEffect(() => {
    if (!isAuthed) return;
    if (!sessionStart) return;
    void loadNotesFromDb(sessionStart);
  }, [isAuthed, sessionStart]);

  const rowExerciseKey = rows.map((r) => r.exercise_id ?? "").join(",");

  // re-fetch max load stats whenever the set of exercises in rows changes
  useEffect(() => {
    if (!isAuthed || rows.length === 0) return;
    void loadMaxLoadStats(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, rowExerciseKey]);

  const filteredAddExercises = useMemo(() => {
    const q = addExerciseQuery.trim().toLowerCase();
    if (!q) return exerciseList;
    return exerciseList.filter((e) => e.canonical_name.toLowerCase().includes(q));
  }, [exerciseList, addExerciseQuery]);

  const selectedGroupExercises = useMemo(() => {
    const group = groups.find((g) => g.id === addGroupId);
    if (!group) return [];
    return group.exerciseIds
      .map((id) => exerciseById.get(id))
      .filter((e): e is Exercise => !!e);
  }, [addGroupId, exerciseById, groups]);

  // ── Loading / auth-check state ────────────────────────────────────────────
  if (!authReady) {
    return (
      <main className="min-h-screen bg-gym-bg flex items-center justify-center">
        <div className="card text-center space-y-3">
          <svg className="animate-spin h-6 w-6 text-blue-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-slate-400">Checking sign-in…</p>
        </div>
      </main>
    );
  }

  // ── Sign-in screen ────────────────────────────────────────────────────────
  if (!isAuthed) {
    return (
      <main className="min-h-screen bg-gym-bg flex items-center justify-center p-4">
        <div className="card max-w-sm w-full space-y-5">
          <div>
            <p className="section-title">Gym Tracker</p>
            <h1 className="text-2xl font-bold text-slate-100 mt-0.5">Sign in</h1>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => void signInWithGoogle()}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg border border-slate-600 bg-white text-slate-900 font-medium text-sm hover:bg-slate-100 transition-colors disabled:opacity-60"
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                <path fill="none" d="M0 0h48v48H0z"/>
              </svg>
              {googleLoading ? "Redirecting…" : "Continue with Google"}
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-700" />
              <span className="text-xs text-slate-500">or</span>
              <div className="flex-1 h-px bg-slate-700" />
            </div>

            <div>
              <label className="label">Email address</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                onKeyDown={(e) => { if (e.key === "Enter") void signInMagicLink(); }}
              />
            </div>
            <button onClick={() => void signInMagicLink()} className="btn-primary w-full">
              Send magic link
            </button>
          </div>

          {msg && (
            <p className="text-sm text-center text-slate-300 border border-slate-600 rounded-lg px-3 py-2">
              {msg}
            </p>
          )}
        </div>
      </main>
    );
  }

  // ── Main logged-in view ───────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gym-bg pb-20">
      <div className="max-w-2xl mx-auto px-2 py-2 space-y-2 sm:px-4 sm:py-6 sm:space-y-4">

        {/* Header */}
        <div className="card flex items-center justify-between gap-2 flex-wrap sm:gap-4">
          <div>
            <p className="section-title">Log Session</p>
            <h1 className="text-base font-bold text-slate-100 mt-0.5 flex items-center gap-2 sm:text-xl">
              {todayIso()}
              <span className={`badge ${mode === "plan" ? "badge-blue" : "badge-slate"}`}>
                {mode === "plan" ? "Plan" : "Ad-hoc"}
              </span>
              {planId && <span className="text-xs text-slate-500 font-normal">#{planId}</span>}
            </h1>
          </div>
          <Link href="/" className="btn-ghost">
            ← Today&apos;s Plan
          </Link>
        </div>

        {/* Toolbar */}
        <div className="flex gap-1.5 flex-wrap items-center sm:gap-2">
          <button onClick={() => void refreshPlan()} className="btn-secondary">
            Refresh plan
          </button>
          <button onClick={startAdhocWorkout} className="btn-secondary">
            Ad-hoc
          </button>
          <button onClick={newSession} className="btn-ghost">
            New session
          </button>
          <button onClick={signOut} className="btn-ghost">
            Sign out
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <label className="label mb-0 whitespace-nowrap">Duration&nbsp;(min)</label>
            <input
              type="text"
              inputMode="numeric"
              value={String(sessionDurationMin)}
              onChange={(e) => setSessionDurationMin(Number(parseNumberOrBlank(e.target.value) || 0))}
              className="input-sm w-16 text-center"
            />
          </div>
        </div>

        {/* Status */}
        {msg && (
          <div className="rounded-lg border border-blue-700 bg-blue-950 px-4 py-3 text-sm text-blue-200">
            {msg}
          </div>
        )}

        {/* Add exercise */}
        <div className="card space-y-2 sm:space-y-3">
          <p className="section-title">Add exercise</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={addExerciseQuery}
              onChange={(e) => setAddExerciseQuery(e.target.value)}
              placeholder="Search…"
              className="input sm:w-40 shrink-0"
            />
            <select
              value={addExerciseId === "" ? "" : String(addExerciseId)}
              onChange={(e) => setAddExerciseId(e.target.value ? Number(e.target.value) : "")}
              className="input flex-1"
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
            <button onClick={() => void addExercise()} className="btn-primary shrink-0">
              Add
            </button>
          </div>
        </div>

        {/* Add exercise group */}
        <div className="card space-y-2 sm:space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="section-title">Add group</p>
              {selectedGroupExercises.length > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  {selectedGroupExercises.map((e) => e.canonical_name).join(", ")}
                </p>
              )}
            </div>
            <Link href="/admin/exercises" className="btn-ghost">
              Manage groups
            </Link>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={addGroupId}
              onChange={(e) => setAddGroupId(e.target.value)}
              className="input flex-1"
            >
              <option value="">Select group...</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.exerciseIds.length})
                </option>
              ))}
            </select>
            <button
              onClick={() => void addExerciseGroup()}
              disabled={!addGroupId}
              className="btn-primary shrink-0"
            >
              Add Group
            </button>
          </div>
        </div>

        {/* Exercise cards */}
        <div className="space-y-2 sm:space-y-3">
          {rows.length === 0 && (
            <div className="card text-center text-slate-400 py-8">
              <p>No exercises. Load a plan or add exercises above.</p>
            </div>
          )}

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

            const exId = r.exercise_id ?? null;
            const exNoteVal = exId ? (exerciseNotes[exId] ?? "") : "";

            return (
              <div key={k} className="card space-y-2 sm:space-y-3">
                {/* Card header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-slate-500 font-mono">{r.sequence_no}</span>
                      <h3 className="font-semibold text-slate-100 truncate">{r.exercise_name}</h3>
                      <span className={typeBadgeClass(r.exercise_type)}>
                        {typeLabel(r.exercise_type)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => void removeRow(r.sequence_no)}
                    className="btn-danger shrink-0 text-xs px-2 py-1"
                  >
                    Remove
                  </button>
                </div>

                {/* Max load stats for progressive overload guidance */}
                {isStrengthType(r.exercise_type) && exId != null && maxLoadStats[exId] != null && (
                  <div className="flex items-center justify-center gap-2 text-xs">
                    <span className="text-slate-400">Best:</span>
                    <span className="font-semibold text-amber-400">{maxLoadStats[exId].max_load_kg} kg</span>
                    <span className="text-slate-500">·</span>
                    <span className="font-semibold text-amber-400">{maxLoadStats[exId].times_at_max} {maxLoadStats[exId].times_at_max === 1 ? "day" : "days"} at this weight</span>
                  </div>
                )}

                {/* Quick exercise note */}
                {exId != null && (
                  <details open={!!exNoteVal || activeNoteExerciseId === exId} className="rounded-lg border border-slate-700 bg-slate-900/30 p-2">
                    <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-slate-400">
                      Quick note
                    </summary>
                    <input
                      type="text"
                      value={exNoteVal}
                      maxLength={30}
                      onFocus={() => setActiveNoteExerciseId(exId)}
                      onBlur={() => setActiveNoteExerciseId((current) => (current === exId ? null : current))}
                      onChange={(e) => {
                        const v = e.target.value.slice(0, 30);
                        setExerciseNotes((prev) => ({ ...prev, [exId]: v }));
                        queueSaveExerciseNote(exId, v);
                      }}
                      placeholder='e.g. "2 sets @10, 1 @9"'
                      className="input mt-2"
                    />
                  </details>
                )}

                {/* Strength inputs */}
                {isStrengthType(r.exercise_type) && (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="label">Reps</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={showReps === "" ? "" : String(showReps)}
                        onChange={(e) => {
                          const raw = parseNumberOrBlank(e.target.value);
                          setReps((prev) => ({ ...prev, [k]: raw }));
                          if (raw !== "" && mode === "plan") queueAutosave(r.sequence_no, { target_reps: clampReps(raw) });
                        }}
                        className="input-sm w-full text-center"
                      />
                    </div>
                    <div>
                      <label className="label">Load (kg)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={showLoad}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setLoads((prev) => ({ ...prev, [k]: raw }));
                          if (mode === "plan") queueAutosave(r.sequence_no, { target_load_kg: parseDecimalOrNull(raw) });
                        }}
                        className="input-sm w-full text-center"
                      />
                    </div>
                    <div>
                      <label className="label">Sets</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={showSets === "" ? "" : String(showSets)}
                        onChange={(e) => {
                          const v = parseNumberOrBlank(e.target.value);
                          setSets((prev) => ({ ...prev, [k]: v }));
                          if (v !== "" && mode === "plan") queueAutosave(r.sequence_no, { target_sets: Math.max(1, Math.round(v)) });
                        }}
                        className="input-sm w-full text-center"
                      />
                    </div>
                  </div>
                )}

                {/* Timed inputs */}
                {isTimedType(r.exercise_type) && (
                  <div className="flex gap-3 flex-wrap items-end">
                    <div>
                      <label className="label">Target</label>
                      <p className="text-slate-300 text-sm font-medium">{targetMin} min</p>
                    </div>
                    <div>
                      <label className="label">Duration (min)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={showMin === "" ? "" : String(showMin)}
                        onChange={(e) => {
                          const v = parseNumberOrBlank(e.target.value);
                          setDurationsMin((prev) => ({ ...prev, [k]: v }));
                          if (v !== "" && mode === "plan") queueAutosave(r.sequence_no, { target_duration_sec: Math.max(0, Math.round(v * 60)) });
                          if (v === "" && mode === "plan") queueAutosave(r.sequence_no, { target_duration_sec: 0 });
                        }}
                        className="input-sm w-20 text-center"
                      />
                    </div>
                    {showCaloriesField && (
                      <div>
                        <label className="label">Calories (kcal)</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={showCalories === "" ? "" : String(showCalories)}
                          onChange={(e) => {
                            const v = parseNumberOrBlank(e.target.value);
                            setCaloriesKcal((prev) => ({ ...prev, [k]: v }));
                          }}
                          className="input-sm w-24 text-center"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Swap exercise */}
                <details className="rounded-lg border border-slate-700 bg-slate-900/30 p-2">
                  <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-slate-400">
                    Swap exercise
                  </summary>
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
                    className="input mt-2"
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
                </details>
              </div>
            );
          })}
        </div>

        {/* Auto-save status */}
        {(exNoteMsg || notesMsg) && (
          <p className="text-xs text-slate-500 text-center">
            {[exNoteMsg, notesMsg].filter(Boolean).join(" · ")}
          </p>
        )}

        {/* Session notes */}
        <div className="card space-y-2">
          <p className="section-title">Session notes</p>
          <textarea
            value={sessionNotes}
            onChange={(e) => {
              const v = e.target.value;
              setSessionNotes(v);

              if (notesSaveTimer.current) clearTimeout(notesSaveTimer.current);
              notesSaveTimer.current = setTimeout(() => {
                const ss = sessionStart || ensureSessionStart();
                void saveNotesToDb(ss, v);
              }, 600);
            }}
            placeholder="Notes for this session…"
            className="input min-h-[80px] resize-y"
          />
        </div>
      </div>

      {/* Sticky save footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-700 bg-slate-900/95 backdrop-blur-sm px-3 py-2 sm:px-4 sm:py-3">
        <div className="max-w-2xl mx-auto">
          <button onClick={() => void saveSession()} className="btn-primary w-full text-base py-3">
            Save Session
          </button>
        </div>
      </div>
    </main>
  );
}

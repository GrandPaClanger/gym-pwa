"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { installAuthRecovery, localSignOut } from "@/lib/authRecovery";
import { ExerciseGroup, readExerciseGroups } from "@/lib/exerciseGroups";

type TodayRow = {
  plan_date: string;
  sequence_no: number;
  exercise_id: number | null;
  exercise_name: string;
  exercise_type: number; // 1 strength, 2 cardio, 4 classes
  target_sets: number | null;
  target_reps: number | null;
  target_duration_sec: number | null;
  suggested_load_kg: number | null;
  is_active: boolean;
};

type Exercise = {
  exercise_id: number;
  canonical_name: string;
  exercise_type: number;
  is_active: boolean;
};

type DayType = "Push" | "Pull" | "Legs";

type PlanInsertRow = {
  plan_id: number;
  sequence_no: number;
  exercise_id: number;
  target_sets: number;
  target_reps: number;
  target_load_kg: null;
  target_duration_sec: number | null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const WORKING_SESSION_LIMIT_MIN = 75;
const CARDIO_MIN = 30;
const STRENGTH_EXERCISE_MIN = 5;
const CORE_EXERCISE_COUNT = 3;
const SPLIT_EXERCISE_COUNT = Math.floor(
  (WORKING_SESSION_LIMIT_MIN - CARDIO_MIN - CORE_EXERCISE_COUNT * STRENGTH_EXERCISE_MIN) /
    STRENGTH_EXERCISE_MIN
);

function minsFromSec(sec: number | null) {
  if (!sec || sec <= 0) return 0;
  return Math.round(sec / 60);
}

const isCardioType = (exerciseType: number) => exerciseType === 2;
const isClassType = (exerciseType: number) => exerciseType === 4;
const isTimedType = (exerciseType: number) => isCardioType(exerciseType) || isClassType(exerciseType);
const isStrengthType = (exerciseType: number) => !isTimedType(exerciseType);
const typeLabel = (exerciseType: number) =>
  isClassType(exerciseType) ? "Class" : isCardioType(exerciseType) ? "Cardio" : "Strength";
const typeBadgeClass = (exerciseType: number) =>
  isClassType(exerciseType) ? "badge-purple" : isCardioType(exerciseType) ? "badge-green" : "badge-blue";
const norm = (value: string) => value.trim().toLowerCase();
const targetSetsFor = (exerciseType: number) => (isStrengthType(exerciseType) ? 3 : 1);
const targetRepsFor = (exerciseType: number) => (isStrengthType(exerciseType) ? 10 : 1);

function targetText(r: TodayRow) {
  if (isTimedType(r.exercise_type)) {
    const m = minsFromSec(r.target_duration_sec);
    return m > 0 ? `${m} min` : "-";
  }
  const sets = r.target_sets ?? 3;
  const reps = r.target_reps ?? 10;
  return `${sets} x ${reps}`;
}

function findGroup(groups: ExerciseGroup[], names: string | string[]) {
  const wantedNames = Array.isArray(names) ? names.map(norm) : [norm(names)];
  return (
    groups.find((group) => wantedNames.includes(norm(group.name))) ??
    groups.find((group) => wantedNames.some((name) => norm(group.name).includes(name)))
  );
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function HomePage() {
  const router = useRouter();

  const [isAuthed, setIsAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingStuck, setLoadingStuck] = useState(false);
  const [rows, setRows] = useState<TodayRow[]>([]);
  const [dayType, setDayType] = useState<DayType>("Push");

  const checkIsAdmin = async () => {
    const { data, error } = await supabase.rpc("is_admin_user");
    setIsAdmin(!error && !!data);
  };

  const loadToday = async () => {
    setMsg("");
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("v_plan_today_edit")
        .select(
          "plan_date, sequence_no, exercise_id, exercise_name, exercise_type, target_sets, target_reps, target_duration_sec, suggested_load_kg, is_active"
        )
        .eq("plan_date", todayIso())
        .eq("is_active", true)
        .order("sequence_no", { ascending: true });

      if (error) {
        setRows([]);
        setMsg(error.message);
        return;
      }

      setRows((data as TodayRow[]) ?? []);
    } finally {
      setLoading(false);
    }
  };

  const getPersonId = async (): Promise<number | null> => {
    const { data, error } = await supabase.rpc("my_person_id");
    if (error) {
      setMsg(error.message);
      return null;
    }
    const n = Number(data);
    return Number.isFinite(n) ? n : null;
  };

  const loadPlanIdForToday = async (): Promise<number | null> => {
    const personId = await getPersonId();
    if (!personId) return null;

    const { data, error } = await supabase
      .from("workout_plan")
      .select("plan_id")
      .eq("person_id", personId)
      .eq("plan_date", todayIso())
      .order("plan_id", { ascending: false })
      .limit(1);

    if (error) {
      setMsg(error.message);
      return null;
    }

    const id = (data as { plan_id: number }[])?.[0]?.plan_id;
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  };

  const createEmptyPlanForToday = async (): Promise<number | null> => {
    const personId = await getPersonId();
    if (!personId) return null;

    const { data, error } = await supabase
      .from("workout_plan")
      .insert({ person_id: personId, plan_date: todayIso() })
      .select("plan_id")
      .single();

    if (error) {
      setMsg(error.message);
      return null;
    }

    const id = Number((data as { plan_id: number }).plan_id);
    return Number.isFinite(id) ? id : null;
  };

  const loadExerciseList = async (): Promise<Exercise[]> => {
    const { data, error } = await supabase
      .from("exercise")
      .select("exercise_id, canonical_name, exercise_type, is_active")
      .eq("is_active", true)
      .order("canonical_name", { ascending: true });

    if (error) {
      setMsg(error.message);
      return [];
    }

    return ((data as Exercise[]) ?? []).map((exercise) => ({
      exercise_id: Number(exercise.exercise_id),
      canonical_name: String(exercise.canonical_name),
      exercise_type: Number(exercise.exercise_type),
      is_active: !!exercise.is_active,
    }));
  };

  const generateRegenerate = async () => {
    setMsg("");
    const [exercises, groupResult] = await Promise.all([
      loadExerciseList(),
      readExerciseGroups(supabase),
    ]);
    if (groupResult.error) return setMsg(groupResult.error);

    const exerciseById = new Map(exercises.map((exercise) => [exercise.exercise_id, exercise]));
    const cardioGroup = findGroup(groupResult.groups, ["Cardio", "Cardi_Main", "Cardio_Main"]);
    const splitGroup = findGroup(groupResult.groups, dayType);
    const coreGroup = findGroup(groupResult.groups, "Core");

    const missing = [
      cardioGroup ? "" : "Cardio",
      splitGroup ? "" : dayType,
      coreGroup ? "" : "Core",
    ].filter(Boolean);
    if (missing.length > 0) {
      return setMsg(`Create exercise groups named ${missing.join(", ")} before generating this split.`);
    }

    const requiredCardioGroup = cardioGroup;
    const requiredSplitGroup = splitGroup;
    const requiredCoreGroup = coreGroup;
    if (!requiredCardioGroup || !requiredSplitGroup || !requiredCoreGroup) return;

    const cardio = shuffled(
      requiredCardioGroup.exerciseIds
        .map((id) => exerciseById.get(id))
        .filter((exercise): exercise is Exercise => !!exercise && isCardioType(exercise.exercise_type))
    ).slice(0, 1);
    const splitExercises = shuffled(
      requiredSplitGroup.exerciseIds
        .map((id) => exerciseById.get(id))
        .filter((exercise): exercise is Exercise => !!exercise && isStrengthType(exercise.exercise_type))
    ).slice(0, SPLIT_EXERCISE_COUNT);
    const coreExercises = shuffled(
      requiredCoreGroup.exerciseIds
        .map((id) => exerciseById.get(id))
        .filter((exercise): exercise is Exercise => !!exercise && isStrengthType(exercise.exercise_type))
    ).slice(0, CORE_EXERCISE_COUNT);

    if (cardio.length === 0) return setMsg("The Cardio group needs at least one active cardio exercise.");
    if (splitExercises.length === 0) return setMsg(`The ${dayType} group needs at least one active strength exercise.`);
    if (coreExercises.length === 0) return setMsg("The Core group needs at least one active strength exercise.");

    const selected = [...cardio, ...splitExercises, ...coreExercises];
    const planId = (await loadPlanIdForToday()) ?? (await createEmptyPlanForToday());
    if (!planId) return;

    const { error: deleteError } = await supabase
      .from("workout_plan_item")
      .delete()
      .eq("plan_id", planId);
    if (deleteError) return setMsg(deleteError.message);

    const insertRows: PlanInsertRow[] = selected.map((exercise, index) => ({
      plan_id: planId,
      sequence_no: (index + 1) * 10,
      exercise_id: exercise.exercise_id,
      target_sets: targetSetsFor(exercise.exercise_type),
      target_reps: targetRepsFor(exercise.exercise_type),
      target_load_kg: null,
      target_duration_sec: isCardioType(exercise.exercise_type) ? CARDIO_MIN * 60 : null,
    }));

    const { error: insertError } = await supabase.from("workout_plan_item").insert(insertRows);
    if (insertError) return setMsg(insertError.message);

    await loadToday();
    const estimatedMin = CARDIO_MIN + (splitExercises.length + coreExercises.length) * STRENGTH_EXERCISE_MIN;
    setMsg(
      `${dayType} day generated: 30 min cardio, ${splitExercises.length} ${dayType.toLowerCase()}, ${coreExercises.length} core. Estimated ${estimatedMin} min.`
    );
  };

  const generateEmptyPlan = async () => {
    setMsg("");
    const planId = (await loadPlanIdForToday()) ?? (await createEmptyPlanForToday());
    if (!planId) return;

    const { error } = await supabase
      .from("workout_plan_item")
      .delete()
      .eq("plan_id", planId);

    if (error) return setMsg(error.message);

    await loadToday();
    setMsg("Empty plan ready.");
  };

  const refresh = async () => {
    await loadToday();
    setMsg("");
  };

  const signOut = () => {
    setIsAdmin(false);
    setIsAuthed(false);
    setRows([]);
    setMsg("");
    void localSignOut();
    router.push("/log");
  };

  useEffect(() => {
    let mounted = true;
    const stuckTimer = setTimeout(() => setLoadingStuck(true), 6000);
    const removeAuthRecovery = installAuthRecovery(() => {
      if (!mounted) return;
      setIsAuthed(false);
      setIsAdmin(false);
      setRows([]);
      router.replace("/log");
    });

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const ok = !!data.session;
        if (!mounted) return;
        setIsAuthed(ok);
        if (!ok) {
          clearTimeout(stuckTimer);
          setLoading(false);
          router.replace("/log");
          return;
        }
        await Promise.all([checkIsAdmin(), loadToday()]);
      } catch (error) {
        console.error("Initial auth/load failed", error);
        if (!mounted) return;
        setIsAuthed(false);
        setMsg("Connection timed out. Please sign in again.");
        router.replace("/log");
      } finally {
        clearTimeout(stuckTimer);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const ok = !!session;
      setIsAuthed(ok);
      if (!ok) {
        setIsAdmin(false);
        setRows([]);
        setMsg("");
        router.replace("/log");
        return;
      }
      void Promise.all([checkIsAdmin(), loadToday()]).catch((error) => {
        console.error("Auth state reload failed", error);
        setMsg("Connection timed out. Please refresh or sign in again.");
      });
    });

    return () => {
      mounted = false;
      clearTimeout(stuckTimer);
      removeAuthRecovery();
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titleDate = useMemo(() => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }, []);

  const dayName = useMemo(() => {
    return new Date().toLocaleDateString("en-GB", { weekday: "long" });
  }, []);

  return (
    <main className="min-h-screen bg-gym-bg">
      <div className="max-w-2xl mx-auto px-2 py-2 space-y-2 sm:px-4 sm:py-6 sm:space-y-4">
        <div className="card flex items-center justify-between gap-2 flex-wrap sm:gap-4">
          <div>
            <p className="section-title">Today&apos;s Plan</p>
            <h1 className="text-lg font-bold text-slate-100 mt-0.5 sm:text-2xl">
              {dayName}
              <span className="ml-2 text-slate-400 text-sm font-normal sm:text-lg">{titleDate}</span>
            </h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href="/log" className="btn-primary">
              Log Session
            </Link>
            {isAdmin && (
              <Link href="/admin/exercises" className="btn-secondary">
                Admin
              </Link>
            )}
          </div>
        </div>

        <div className="card space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {(["Push", "Pull", "Legs"] as DayType[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDayType(option)}
                className={option === dayType ? "btn-primary" : "btn-secondary"}
                disabled={!isAuthed}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 flex-wrap items-center sm:gap-2">
            {isAuthed && (
              <>
                <button onClick={generateRegenerate} className="btn-secondary" disabled={!isAuthed}>
                  Generate {dayType} Day
                </button>
                <button onClick={generateEmptyPlan} className="btn-secondary" disabled={!isAuthed}>
                  Empty Plan
                </button>
                <button onClick={refresh} className="btn-ghost" disabled={!isAuthed}>
                  Refresh
                </button>
              </>
            )}
            <button onClick={signOut} className="btn-ghost ml-auto">
              Sign out
            </button>
          </div>
        </div>

        {msg && (
          <div className="rounded-lg border border-blue-700 bg-blue-950 px-4 py-3 text-sm text-blue-200">
            {msg}
          </div>
        )}

        {loading && !loadingStuck && (
          <div className="card flex items-center gap-3 text-slate-400">
            <svg className="animate-spin h-4 w-4 text-blue-500 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading plan...
          </div>
        )}

        {loading && loadingStuck && (
          <div className="card space-y-3 text-center">
            <p className="text-slate-300">Taking longer than expected...</p>
            <p className="text-sm text-slate-500">Your session may have expired.</p>
            <button onClick={signOut} className="btn-primary">
              Sign out and start fresh
            </button>
          </div>
        )}

        {!loading && (
          <div className="space-y-2">
            {rows.length === 0 ? (
              <div className="card text-center text-slate-400 py-10">
                <p className="text-lg mb-2">No plan for today</p>
                <p className="text-sm">Choose Push, Pull, or Legs, then generate the day.</p>
              </div>
            ) : (
              rows.map((r) => (
                <div
                  key={`${r.plan_date}-${r.sequence_no}`}
                  className="card flex items-center gap-4"
                >
                  <span className="w-7 text-center text-slate-500 text-sm font-mono shrink-0">
                    {r.sequence_no}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-100 truncate">{r.exercise_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={typeBadgeClass(r.exercise_type)}>
                        {typeLabel(r.exercise_type)}
                      </span>
                      <span className="text-sm text-slate-400">{targetText(r)}</span>
                    </div>
                  </div>
                  {r.suggested_load_kg != null && (
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-slate-200">{r.suggested_load_kg} kg</p>
                      <p className="text-xs text-slate-500">suggested</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type TodayRow = {
  plan_date: string;
  sequence_no: number;
  exercise_name: string;
  exercise_type: number; // 1 strength, 2 cardio
  target_sets: number | null;
  target_reps: number | null;
  target_duration_sec: number | null;
  suggested_load_kg: number | null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function minsFromSec(sec: number | null) {
  if (!sec || sec <= 0) return 0;
  return Math.round(sec / 60);
}

function targetText(r: TodayRow) {
  if (r.exercise_type === 2) {
    const m = minsFromSec(r.target_duration_sec);
    return m > 0 ? `${m} min` : "—";
  }
  const sets = r.target_sets ?? 3;
  const reps = r.target_reps ?? 10;
  return `${sets} × ${reps}`;
}

export default function HomePage() {
  const router = useRouter();

  const [isAuthed, setIsAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingStuck, setLoadingStuck] = useState(false);
  const [rows, setRows] = useState<TodayRow[]>([]);

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
          "plan_date, sequence_no, exercise_name, exercise_type, target_sets, target_reps, target_duration_sec, suggested_load_kg"
        )
        .eq("plan_date", todayIso())
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

  const generateRegenerate = async () => {
    setMsg("");
    const { error } = await supabase.rpc("generate_plan_days", {
      p_start_date: todayIso(),
      p_days: 1,
      p_cooldown_days: 10,
    });
    if (error) return setMsg(error.message);
    await loadToday();
    setMsg("Plan generated.");
  };

  const generateEmptyPlan = async () => {
    setMsg("");
    const { error } = await supabase.rpc("generate_empty_plan", {
      p_plan_date: todayIso(),
    });
    if (error) return setMsg(error.message);
    await loadToday();
    setMsg("Empty plan generated.");
  };

  const refresh = async () => {
    await loadToday();
    setMsg("");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setIsAdmin(false);
    setRows([]);
    setMsg("");
    router.push("/log");
  };

  useEffect(() => {
    // Safety valve: if still loading after 6 seconds, surface an escape hatch
    const stuckTimer = setTimeout(() => setLoadingStuck(true), 6000);

    (async () => {
      const { data } = await supabase.auth.getSession();
      const ok = !!data.session;
      setIsAuthed(ok);
      if (!ok) {
        clearTimeout(stuckTimer);
        setLoading(false);
        router.replace("/log");
        return;
      }
      await checkIsAdmin();
      await loadToday();
      clearTimeout(stuckTimer);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const ok = !!session;
      setIsAuthed(ok);
      if (!ok) {
        setIsAdmin(false);
        setRows([]);
        setMsg("");
        router.replace("/log");
        return;
      }
      await checkIsAdmin();
      await loadToday();
    });

    return () => {
      clearTimeout(stuckTimer);
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
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

        {/* Header card */}
        <div className="card flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="section-title">Today&apos;s Plan</p>
            <h1 className="text-2xl font-bold text-slate-100 mt-0.5">
              {dayName}
              <span className="ml-2 text-slate-400 text-lg font-normal">{titleDate}</span>
            </h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href="/log" className="btn-primary">
              Log Session →
            </Link>
            {isAdmin && (
              <Link href="/admin/exercises" className="btn-secondary">
                Admin
              </Link>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap items-center">
          {isAuthed && (
            <>
              <button onClick={generateRegenerate} className="btn-secondary" disabled={!isAuthed}>
                Generate / Regenerate
              </button>
              <button onClick={generateEmptyPlan} className="btn-secondary" disabled={!isAuthed}>
                Empty Plan
              </button>
              <button onClick={refresh} className="btn-ghost" disabled={!isAuthed}>
                Refresh
              </button>
            </>
          )}
          {/* Sign out always visible so user is never trapped */}
          <button onClick={signOut} className="btn-ghost ml-auto">
            Sign out
          </button>
        </div>

        {/* Status message */}
        {msg && (
          <div className="rounded-lg border border-blue-700 bg-blue-950 px-4 py-3 text-sm text-blue-200">
            {msg}
          </div>
        )}

        {/* Loading */}
        {loading && !loadingStuck && (
          <div className="card flex items-center gap-3 text-slate-400">
            <svg className="animate-spin h-4 w-4 text-blue-500 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading plan…
          </div>
        )}

        {/* Escape hatch if loading hangs */}
        {loading && loadingStuck && (
          <div className="card space-y-3 text-center">
            <p className="text-slate-300">Taking longer than expected…</p>
            <p className="text-sm text-slate-500">Your session may have expired.</p>
            <button onClick={signOut} className="btn-primary">
              Sign out and start fresh
            </button>
          </div>
        )}

        {/* Exercise list */}
        {!loading && (
          <div className="space-y-2">
            {rows.length === 0 ? (
              <div className="card text-center text-slate-400 py-10">
                <p className="text-lg mb-2">No plan for today</p>
                <p className="text-sm">Use Generate above, or log an ad-hoc workout.</p>
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
                      <span className={r.exercise_type === 2 ? "badge-green" : "badge-blue"}>
                        {r.exercise_type === 2 ? "Cardio" : "Strength"}
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

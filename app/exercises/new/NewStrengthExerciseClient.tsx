"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Slot = { slot_code: string };

function safeReturnPath(p?: string) {
  return p && p.startsWith("/") ? p : "/log";
}

export default function NewStrengthExerciseClient({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const backTo = safeReturnPath(returnTo);

  const [name, setName] = useState("");
  const [slotCode, setSlotCode] = useState<string>("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("plan_slot")
      .select("slot_code")
      .order("slot_code")
      .then(({ data, error }) => {
        if (error) setMsg(error.message);
        else setSlots((data ?? []) as Slot[]);
      });
  }, []);

  const save = async () => {
    setMsg("");
    const trimmed = name.trim();
    if (!trimmed) return setMsg("Exercise name is required.");

    setSaving(true);

    const { data: ex, error: exErr } = await supabase
      .from("exercise")
      .insert({ canonical_name: trimmed, exercise_type: 1 })
      .select("exercise_id")
      .single();

    if (exErr) {
      setSaving(false);
      return setMsg(exErr.message);
    }

    const exercise_id = ex.exercise_id as number;

    if (slotCode) {
      const { error: slotErr } = await supabase
        .from("exercise_slot")
        .insert({ exercise_id, slot_code: slotCode });

      if (slotErr) {
        setSaving(false);
        return setMsg(`Exercise created (ID ${exercise_id}) but slot failed: ${slotErr.message}`);
      }
    }

    router.push(backTo);
  };

  return (
    <main className="min-h-screen bg-gym-bg flex items-start justify-center p-4 pt-12">
      <div className="card max-w-md w-full space-y-5">
        <div>
          <p className="section-title">Exercises</p>
          <h1 className="text-2xl font-bold text-slate-100 mt-0.5">Add Strength Exercise</h1>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Seated Row (Machine)"
              className="input"
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
            />
          </div>

          <div>
            <label className="label">Slot (optional)</label>
            <select
              value={slotCode}
              onChange={(e) => setSlotCode(e.target.value)}
              className="input"
            >
              <option value="">(no slot)</option>
              {slots.map((s) => (
                <option key={s.slot_code} value={s.slot_code}>
                  {s.slot_code}
                </option>
              ))}
            </select>
          </div>

          {msg && (
            <div className="rounded-lg border border-red-700 bg-red-950 px-4 py-3 text-sm text-red-300">
              {msg}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={void save}
              disabled={saving}
              className="btn-primary flex-1"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <Link href={backTo} className="btn-secondary flex-1 text-center">
              Cancel
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

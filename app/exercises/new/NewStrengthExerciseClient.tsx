"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
    <main style={{ padding: 20, maxWidth: 700, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Add Strength Exercise</h1>

      <div style={{ display: "grid", gap: 10 }}>
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Seated Row (Machine)"
            style={{ width: "100%", padding: 10, marginTop: 6 }}
          />
        </label>

        <label>
          Slot (optional)
          <select
            value={slotCode}
            onChange={(e) => setSlotCode(e.target.value)}
            style={{ width: "100%", padding: 10, marginTop: 6 }}
          >
            <option value="">(no slot)</option>
            {slots.map((s) => (
              <option key={s.slot_code} value={s.slot_code}>
                {s.slot_code}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={save} disabled={saving} style={{ padding: "10px 14px" }}>
            {saving ? "Saving..." : "Save"}
          </button>

          <a
            href={backTo}
            style={{
              padding: "10px 14px",
              textDecoration: "none",
              border: "1px solid #ddd",
              borderRadius: 8,
              color: "inherit",
            }}
          >
            Cancel
          </a>
        </div>

        {msg && <div style={{ color: "#b00020" }}>{msg}</div>}
      </div>
    </main>
  );
}

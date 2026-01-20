"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Exercise = {
  exercise_id: number;
  canonical_name: string;
  exercise_type: 1 | 2 | 3;
  is_manual_only: boolean;
  is_distance_based: boolean;
  is_active: boolean;
};

function norm(s: string) {
  return (s ?? "").trim().toLowerCase();
}

export default function AdminExercisesPage() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Exercise[]>([]);
  const [slotCodes, setSlotCodes] = useState<string[]>([]);

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Create form
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<1 | 2 | 3>(1);
  const [newManual, setNewManual] = useState(false);
  const [newDistance, setNewDistance] = useState(false);
  const [newActive, setNewActive] = useState(true);

  const [newSlot, setNewSlot] = useState("");
  const [newBaseWeight, setNewBaseWeight] = useState<number | "">(1);

  // Edit form
  const selected = useMemo(
    () => items.find((x) => x.exercise_id === selectedId) ?? null,
    [items, selectedId]
  );

  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<1 | 2 | 3>(1);
  const [editManual, setEditManual] = useState(false);
  const [editDistance, setEditDistance] = useState(false);
  const [editActive, setEditActive] = useState(true);

  const [mapSlot, setMapSlot] = useState("");
  const [mapBaseWeight, setMapBaseWeight] = useState<number | "">(1);

  const filtered = useMemo(() => {
    const q = norm(search);
    if (!q) return items;
    return items.filter((e) => norm(e.canonical_name).includes(q));
  }, [items, search]);

  const loadAll = async () => {
    setMsg("");
    setLoading(true);

    // Admin gate
    const adminRes = await supabase.rpc("is_admin_user");
    if (adminRes.error) {
      setIsAdmin(false);
      setLoading(false);
      setMsg(`Admin check failed: ${adminRes.error.message}`);
      return;
    }
    const ok = !!adminRes.data;
    setIsAdmin(ok);
    if (!ok) {
      setLoading(false);
      setMsg("Not authorized.");
      return;
    }

    // Load exercises + slots via admin RPCs
    const exRes = await supabase.rpc("admin_list_exercises");
    if (exRes.error) {
      setLoading(false);
      setMsg(exRes.error.message);
      return;
    }

    const list: Exercise[] = (exRes.data ?? []).map((r: any) => ({
      exercise_id: Number(r.exercise_id),
      canonical_name: String(r.canonical_name),
      exercise_type: Number(r.exercise_type) as 1 | 2 | 3,
      is_manual_only: !!r.is_manual_only,
      is_distance_based: !!r.is_distance_based,
      is_active: !!r.is_active,
    }));

    const slotRes = await supabase.rpc("admin_list_slot_codes");
    const codes = slotRes.error ? [] : (slotRes.data ?? []).map((r: any) => String(r.slot_code));

    setItems(list);
    setSlotCodes(codes);
    if (!newSlot && codes.length) setNewSlot(codes[0]);
    if (!mapSlot && codes.length) setMapSlot(codes[0]);

    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setIsAuthed(!!data.session);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setIsAuthed(!!session);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  useEffect(() => {
    if (!selected) return;
    setEditName(selected.canonical_name);
    setEditType(selected.exercise_type);
    setEditManual(selected.is_manual_only);
    setEditDistance(selected.is_distance_based);
    setEditActive(selected.is_active);
  }, [selectedId, selected]);

  const createExercise = async () => {
    setMsg("");
    if (!isAdmin) return;

    const name = newName.trim();
    if (!name) return setMsg("Enter a name.");

    const dist = newType === 2 ? newDistance : false;

    const res = await supabase.rpc("admin_create_exercise", {
      p_canonical_name: name,
      p_exercise_type: newType,
      p_is_manual_only: newManual,
      p_is_distance_based: dist,
      p_is_active: newActive,
    });

    if (res.error) return setMsg(res.error.message);

    const newId = Number(res.data);
    if (!Number.isFinite(newId)) return setMsg("Create failed: invalid return.");

    // Optional mapping
    if (newSlot.trim()) {
      const bw = newBaseWeight === "" ? 1 : Number(newBaseWeight);
      const baseWeight = Number.isFinite(bw) ? bw : 1;

      const mapRes = await supabase.rpc("admin_map_exercise_slot", {
        p_exercise_id: newId,
        p_slot_code: newSlot.trim(),
        p_base_weight: baseWeight,
      });

      if (mapRes.error) {
        await loadAll();
        return setMsg(`Created (id=${newId}) but mapping failed: ${mapRes.error.message}`);
      }
    }

    setNewName("");
    setNewType(1);
    setNewManual(false);
    setNewDistance(false);
    setNewActive(true);
    setNewBaseWeight(1);

    await loadAll();
    setSelectedId(newId);
    setMsg("Exercise created.");
  };

  const saveEdits = async () => {
    setMsg("");
    if (!isAdmin || !selected) return;

    const name = editName.trim();
    if (!name) return setMsg("Name cannot be blank.");

    const dist = editType === 2 ? editDistance : false;

    // If you don’t have admin_update_exercise yet, add it (we drafted it earlier).
    const res = await supabase.rpc("admin_update_exercise", {
      p_exercise_id: selected.exercise_id,
      p_exercise_type: editType,
      p_is_manual_only: editManual,
      p_is_distance_based: dist,
      p_is_active: editActive,
    });

    if (res.error) return setMsg(res.error.message);

    await loadAll();
    setSelectedId(selected.exercise_id);
    setMsg("Saved.");
  };

  const mapSlotToSelected = async () => {
    setMsg("");
    if (!isAdmin || !selected) return;

    if (!mapSlot.trim()) return setMsg("Pick a slot.");
    const bw = mapBaseWeight === "" ? 1 : Number(mapBaseWeight);
    const baseWeight = Number.isFinite(bw) ? bw : 1;

    const res = await supabase.rpc("admin_map_exercise_slot", {
      p_exercise_id: selected.exercise_id,
      p_slot_code: mapSlot.trim(),
      p_base_weight: baseWeight,
    });

    if (res.error) return setMsg(res.error.message);

    setMsg("Mapped.");
  };

  if (!isAuthed) {
    return (
      <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
        <h1>Admin · Exercises</h1>
        <p>Please sign in first (use /log).</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 10 }}>Admin · Exercises</h1>

      {msg && <div style={{ marginBottom: 12 }}>{msg}</div>}
      {loading && <div style={{ marginBottom: 12 }}>Loading…</div>}

      {!isAdmin ? (
        <div style={{ padding: 12, border: "1px solid #333", borderRadius: 8 }}>
          Not authorized.
        </div>
      ) : (
        <>
          {/* Create */}
          <div style={{ padding: 12, border: "1px solid #222", borderRadius: 8, marginBottom: 14 }}>
            <b>Create exercise</b>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="canonical_name"
                style={{ padding: 10, minWidth: 280 }}
              />

              <select value={newType} onChange={(e) => setNewType(Number(e.target.value) as any)} style={{ padding: 10 }}>
                <option value={1}>Strength</option>
                <option value={2}>Cardio</option>
                <option value={3}>Other</option>
              </select>

              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={newManual} onChange={(e) => setNewManual(e.target.checked)} />
                Manual-only
              </label>

              <label style={{ display: "flex", gap: 6, alignItems: "center", opacity: newType === 2 ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  checked={newDistance}
                  onChange={(e) => setNewDistance(e.target.checked)}
                  disabled={newType !== 2}
                />
                Distance-based
              </label>

              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={newActive} onChange={(e) => setNewActive(e.target.checked)} />
                Active
              </label>

              <select value={newSlot} onChange={(e) => setNewSlot(e.target.value)} style={{ padding: 10, minWidth: 200 }}>
                <option value="">(No slot mapping)</option>
                {slotCodes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <input
                value={newBaseWeight === "" ? "" : String(newBaseWeight)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") return setNewBaseWeight("");
                  const n = Number(v);
                  if (!Number.isFinite(n)) return;
                  setNewBaseWeight(n);
                }}
                placeholder="base_weight"
                inputMode="decimal"
                style={{ padding: 10, width: 140 }}
              />

              <button onClick={createExercise} style={{ padding: "10px 14px" }}>
                Create
              </button>
            </div>
          </div>

          {/* List + edit */}
          <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 14 }}>
            <div style={{ padding: 12, border: "1px solid #222", borderRadius: 8 }}>
              <b>Exercises</b>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                style={{ marginTop: 10, padding: 10, width: "100%" }}
              />
              <div style={{ marginTop: 10, maxHeight: 520, overflow: "auto", borderTop: "1px solid #222" }}>
                {filtered.map((e) => (
                  <div
                    key={e.exercise_id}
                    onClick={() => setSelectedId(e.exercise_id)}
                    style={{
                      padding: "10px 8px",
                      cursor: "pointer",
                      background: selectedId === e.exercise_id ? "#111" : "transparent",
                      borderBottom: "1px solid #222",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{e.canonical_name}</div>
                    <div style={{ color: "#777", fontSize: 12 }}>
                      id={e.exercise_id} · type={e.exercise_type} · {e.is_active ? "active" : "inactive"}
                      {e.is_manual_only ? " · manual" : ""}
                      {e.is_distance_based ? " · distance" : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: 12, border: "1px solid #222", borderRadius: 8 }}>
              <b>Edit</b>

              {!selected ? (
                <div style={{ marginTop: 10 }}>Pick an exercise from the list.</div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
                    <div style={{ color: "#777" }}>Selected ID: {selected.exercise_id}</div>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      style={{ padding: 10, minWidth: 320 }}
                    />

                    <select value={editType} onChange={(e) => setEditType(Number(e.target.value) as any)} style={{ padding: 10 }}>
                      <option value={1}>Strength</option>
                      <option value={2}>Cardio</option>
                      <option value={3}>Other</option>
                    </select>

                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={editManual} onChange={(e) => setEditManual(e.target.checked)} />
                      Manual-only
                    </label>

                    <label style={{ display: "flex", gap: 6, alignItems: "center", opacity: editType === 2 ? 1 : 0.5 }}>
                      <input
                        type="checkbox"
                        checked={editDistance}
                        onChange={(e) => setEditDistance(e.target.checked)}
                        disabled={editType !== 2}
                      />
                      Distance-based
                    </label>

                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                      Active
                    </label>

                    <button onClick={saveEdits} style={{ padding: "10px 14px" }}>
                      Save
                    </button>
                  </div>

                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #222" }}>
                    <b>Map to slot</b>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
                      <select value={mapSlot} onChange={(e) => setMapSlot(e.target.value)} style={{ padding: 10, minWidth: 220 }}>
                        <option value="">Select slot…</option>
                        {slotCodes.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>

                      <input
                        value={mapBaseWeight === "" ? "" : String(mapBaseWeight)}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "") return setMapBaseWeight("");
                          const n = Number(v);
                          if (!Number.isFinite(n)) return;
                          setMapBaseWeight(n);
                        }}
                        placeholder="base_weight"
                        inputMode="decimal"
                        style={{ padding: 10, width: 140 }}
                      />

                      <button onClick={mapSlotToSelected} style={{ padding: "10px 14px" }}>
                        Map
                      </button>
                    </div>
                    <div style={{ color: "#777", marginTop: 8, fontSize: 12 }}>
                      (This does an upsert/no-op if the mapping already exists.)
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

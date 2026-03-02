"use client";

import Link from "next/link";
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

const norm = (s: string) => (s ?? "").trim().toLowerCase();

function parseNumberOrBlank(v: string): number | "" {
  if (v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

export default function AdminExercisesPage() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const [items, setItems] = useState<Exercise[]>([]);
  const [slotCodes, setSlotCodes] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Create
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<1 | 2 | 3>(1);
  const [newManual, setNewManual] = useState(false);
  const [newDistance, setNewDistance] = useState(false);
  const [newActive, setNewActive] = useState(true);
  const [newSlot, setNewSlot] = useState("");
  const [newBaseWeight, setNewBaseWeight] = useState<number | "">(1);

  // Edit
  const selected = useMemo(
    () => items.find((x) => x.exercise_id === selectedId) ?? null,
    [items, selectedId]
  );
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<1 | 2 | 3>(1);
  const [editManual, setEditManual] = useState(false);
  const [editDistance, setEditDistance] = useState(false);
  const [editActive, setEditActive] = useState(true);

  // Map
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

    // admin gate
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

    // list exercises (admin rpc)
    const exRes = await supabase.rpc("admin_list_exercises");
    if (exRes.error) {
      setLoading(false);
      setMsg(exRes.error.message);
      return;
    }
    const list: Exercise[] = (exRes.data ?? []).map((r: {
      exercise_id: number;
      canonical_name: string;
      exercise_type: number;
      is_manual_only: boolean;
      is_distance_based: boolean;
      is_active: boolean;
    }) => ({
      exercise_id: Number(r.exercise_id),
      canonical_name: String(r.canonical_name),
      exercise_type: Number(r.exercise_type) as 1 | 2 | 3,
      is_manual_only: !!r.is_manual_only,
      is_distance_based: !!r.is_distance_based,
      is_active: !!r.is_active,
    }));
    setItems(list);

    // slot codes (admin rpc)
    const slotRes = await supabase.rpc("admin_list_slot_codes");
    const codes = slotRes.error ? [] : (slotRes.data ?? []).map((r: { slot_code: string }) => String(r.slot_code));
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
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => setIsAuthed(!!session));
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
  }, [selected]);

  const createExercise = async () => {
    setMsg("");
    if (!isAdmin) return setMsg("Not authorized.");

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
    setNewSlot("");
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

  const typeLabel = (t: 1 | 2 | 3) => ({ 1: "Strength", 2: "Cardio", 3: "Other" }[t] ?? "—");
  const typeBadgeClass = (t: 1 | 2 | 3) => ({ 1: "badge-blue", 2: "badge-green", 3: "badge-slate" }[t] ?? "badge-slate");

  if (!isAuthed) {
    return (
      <main className="min-h-screen bg-gym-bg flex items-center justify-center p-4">
        <div className="card max-w-sm w-full text-center space-y-3">
          <p className="text-slate-300">Please sign in first.</p>
          <Link href="/log" className="btn-primary">Go to Login</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gym-bg">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div className="card flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="section-title">Admin</p>
            <h1 className="text-2xl font-bold text-slate-100 mt-0.5">Exercise Maintenance</h1>
          </div>
          <Link href="/" className="btn-ghost">← Today&apos;s Plan</Link>
        </div>

        {/* Status */}
        {msg && (
          <div className="rounded-lg border border-blue-700 bg-blue-950 px-4 py-3 text-sm text-blue-200">
            {msg}
          </div>
        )}

        {loading && (
          <div className="card flex items-center gap-3 text-slate-400">
            <svg className="animate-spin h-4 w-4 text-blue-500 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading…
          </div>
        )}

        {!isAdmin && !loading && (
          <div className="card text-center text-red-400 py-8">Not authorized.</div>
        )}

        {isAdmin && !loading && (
          <>
            {/* Create exercise */}
            <div className="card space-y-4">
              <p className="section-title">Create exercise</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="label">Name</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="canonical_name"
                    className="input"
                  />
                </div>

                <div>
                  <label className="label">Type</label>
                  <select value={newType} onChange={(e) => setNewType(Number(e.target.value) as 1 | 2 | 3)} className="input">
                    <option value={1}>Strength</option>
                    <option value={2}>Cardio</option>
                    <option value={3}>Other</option>
                  </select>
                </div>

                <div>
                  <label className="label">Slot mapping</label>
                  <select value={newSlot} onChange={(e) => setNewSlot(e.target.value)} className="input">
                    <option value="">(No slot mapping)</option>
                    {slotCodes.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div>
                  <label className="label">Base weight</label>
                  <input
                    value={newBaseWeight === "" ? "" : String(newBaseWeight)}
                    onChange={(e) => setNewBaseWeight(parseNumberOrBlank(e.target.value))}
                    placeholder="1"
                    inputMode="decimal"
                    className="input"
                  />
                </div>

                <div className="flex items-end gap-6 pb-1">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-sm">
                    <input type="checkbox" checked={newManual} onChange={(e) => setNewManual(e.target.checked)} className="w-4 h-4 accent-blue-500" />
                    Manual-only
                  </label>
                  <label className={`flex items-center gap-2 cursor-pointer text-sm ${newType === 2 ? "text-slate-300" : "text-slate-600"}`}>
                    <input
                      type="checkbox"
                      checked={newDistance}
                      onChange={(e) => setNewDistance(e.target.checked)}
                      disabled={newType !== 2}
                      className="w-4 h-4 accent-blue-500"
                    />
                    Distance-based
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-sm">
                    <input type="checkbox" checked={newActive} onChange={(e) => setNewActive(e.target.checked)} className="w-4 h-4 accent-blue-500" />
                    Active
                  </label>
                </div>
              </div>

              <button onClick={() => void createExercise()} className="btn-primary">
                Create Exercise
              </button>
            </div>

            {/* Two-column layout: list + detail */}
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">

              {/* Exercise list */}
              <div className="card space-y-3">
                <p className="section-title">Exercises ({filtered.length})</p>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="input"
                />
                <div className="space-y-0.5 max-h-[520px] overflow-y-auto -mx-4 px-4">
                  {filtered.map((e) => (
                    <button
                      key={e.exercise_id}
                      onClick={() => setSelectedId(e.exercise_id)}
                      className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
                        selectedId === e.exercise_id
                          ? "bg-blue-900/50 border border-blue-700"
                          : "hover:bg-slate-700/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-100 text-sm truncate">{e.canonical_name}</span>
                        <span className={typeBadgeClass(e.exercise_type)}>{typeLabel(e.exercise_type)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-xs ${e.is_active ? "text-green-400" : "text-slate-500"}`}>
                          {e.is_active ? "active" : "inactive"}
                        </span>
                        {e.is_manual_only && <span className="text-xs text-slate-500">manual</span>}
                        {e.is_distance_based && <span className="text-xs text-slate-500">distance</span>}
                        <span className="text-xs text-slate-600 ml-auto">#{e.exercise_id}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Detail / edit panel */}
              <div className="card space-y-5">
                {!selected ? (
                  <div className="text-center text-slate-500 py-16">
                    Select an exercise from the list to edit it.
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="section-title">Edit · #{selected.exercise_id}</p>
                      <h2 className="text-lg font-semibold text-slate-100 mt-0.5">{selected.canonical_name}</h2>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="label">Name</label>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input" />
                      </div>

                      <div>
                        <label className="label">Type</label>
                        <select value={editType} onChange={(e) => setEditType(Number(e.target.value) as 1 | 2 | 3)} className="input">
                          <option value={1}>Strength</option>
                          <option value={2}>Cardio</option>
                          <option value={3}>Other</option>
                        </select>
                      </div>

                      <div className="flex gap-6">
                        <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-sm">
                          <input type="checkbox" checked={editManual} onChange={(e) => setEditManual(e.target.checked)} className="w-4 h-4 accent-blue-500" />
                          Manual-only
                        </label>
                        <label className={`flex items-center gap-2 cursor-pointer text-sm ${editType === 2 ? "text-slate-300" : "text-slate-600"}`}>
                          <input
                            type="checkbox"
                            checked={editDistance}
                            onChange={(e) => setEditDistance(e.target.checked)}
                            disabled={editType !== 2}
                            className="w-4 h-4 accent-blue-500"
                          />
                          Distance-based
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-sm">
                          <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} className="w-4 h-4 accent-blue-500" />
                          Active
                        </label>
                      </div>

                      <button onClick={() => void saveEdits()} className="btn-primary">
                        Save Changes
                      </button>
                    </div>

                    <div className="border-t border-slate-700 pt-5 space-y-3">
                      <p className="section-title">Map to slot</p>

                      <div className="flex gap-2 flex-wrap items-end">
                        <div className="flex-1 min-w-[180px]">
                          <label className="label">Slot</label>
                          <select value={mapSlot} onChange={(e) => setMapSlot(e.target.value)} className="input">
                            <option value="">Select slot…</option>
                            {slotCodes.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>

                        <div className="w-28">
                          <label className="label">Base weight</label>
                          <input
                            value={mapBaseWeight === "" ? "" : String(mapBaseWeight)}
                            onChange={(e) => setMapBaseWeight(parseNumberOrBlank(e.target.value))}
                            placeholder="1"
                            inputMode="decimal"
                            className="input"
                          />
                        </div>

                        <button onClick={() => void mapSlotToSelected()} className="btn-secondary">
                          Map
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

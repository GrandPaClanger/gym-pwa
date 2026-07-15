"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { installAuthRecovery, localSignOut } from "@/lib/authRecovery";
import {
  ExerciseGroup,
  readExerciseGroups,
  updateExerciseGroup,
} from "@/lib/exerciseGroups";
import { noNumericAutofillProps } from "@/lib/inputAttributes";

type Exercise = {
  exercise_id: number;
  canonical_name: string;
  exercise_type: ExerciseType;
  is_manual_only: boolean;
  is_distance_based: boolean;
  is_active: boolean;
};

type ExerciseType = 1 | 2 | 3 | 4;
type ExerciseCategory = "Cardio" | "Push" | "Pull" | "Legs" | "Core" | "Class";

const EXERCISE_CATEGORIES: ExerciseCategory[] = ["Cardio", "Push", "Pull", "Legs", "Core", "Class"];

const norm = (s: string) => (s ?? "").trim().toLowerCase();
const categoryType = (category: ExerciseCategory): ExerciseType =>
  category === "Cardio" ? 2 : category === "Class" ? 4 : 1;
const typeCategory = (type: ExerciseType): ExerciseCategory =>
  type === 2 ? "Cardio" : type === 4 ? "Class" : "Pull";

function parseNumberOrBlank(v: string): number | "" {
  if (v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

export default function AdminExercisesPage() {
  const router = useRouter();

  const [isAuthed, setIsAuthed] = useState(false);
  const [authReady, setAuthReady] = useState(false); // don't render until session check done
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");

  const [items, setItems] = useState<Exercise[]>([]);
  const [slotCodes, setSlotCodes] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Create
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<ExerciseCategory>("Pull");
  const [newDistance, setNewDistance] = useState(false);
  const [newActive, setNewActive] = useState(true);

  // Edit
  const selected = useMemo(
    () => items.find((x) => x.exercise_id === selectedId) ?? null,
    [items, selectedId]
  );
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<ExerciseCategory>("Pull");
  const [editType, setEditType] = useState<ExerciseType>(1);
  const [editManual, setEditManual] = useState(false);
  const [editDistance, setEditDistance] = useState(false);
  const [editActive, setEditActive] = useState(true);

  // Map
  const [mapSlot, setMapSlot] = useState("");
  const [mapBaseWeight, setMapBaseWeight] = useState<number | "">(1);

  // Exercise groups
  const [groups, setGroups] = useState<ExerciseGroup[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupExerciseIds, setGroupExerciseIds] = useState<number[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = norm(search);
    if (!q) return items;
    return items.filter((e) => norm(e.canonical_name).includes(q));
  }, [items, search]);

  const activeExercises = useMemo(
    () => items.filter((e) => e.is_active),
    [items]
  );

  const filteredGroupExercises = useMemo(() => {
    const q = norm(groupSearch);
    if (!q) return activeExercises;
    return activeExercises.filter((e) => norm(e.canonical_name).includes(q));
  }, [activeExercises, groupSearch]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  );

  const selectedGroupExerciseNames = useMemo(() => {
    const byId = new Map(items.map((e) => [e.exercise_id, e.canonical_name]));
    return selectedGroup?.exerciseIds.map((id) => byId.get(id)).filter(Boolean) ?? [];
  }, [items, selectedGroup]);

  const categoryForExercise = useCallback((exercise: Exercise): ExerciseCategory => {
    const group = groups.find((g) => g.exerciseIds.includes(exercise.exercise_id));
    if (group && EXERCISE_CATEGORIES.includes(group.name as ExerciseCategory)) {
      return group.name as ExerciseCategory;
    }
    return typeCategory(exercise.exercise_type);
  }, [groups]);

  const loadGroupsFromDb = async () => {
    const { groups: stored, error } = await readExerciseGroups(supabase);
    if (error) {
      setMsg(error);
      setGroups([]);
      setSelectedGroupId("");
      return;
    }
    const standardGroups = EXERCISE_CATEGORIES
      .map((category) => stored.find((group) => norm(group.name) === norm(category)))
      .filter((group): group is ExerciseGroup => !!group);
    setGroups(standardGroups);
    setSelectedGroupId((current) =>
      current && standardGroups.some((g) => g.id === current)
        ? current
        : standardGroups[0]?.id ?? ""
    );
  };

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

    // list exercises
    const exRes = await supabase
      .from("exercise")
      .select("exercise_id, canonical_name, exercise_type, is_manual_only, is_distance_based, is_active")
      .order("canonical_name", { ascending: true });
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
      exercise_type: Number(r.exercise_type) as ExerciseType,
      is_manual_only: !!r.is_manual_only,
      is_distance_based: !!r.is_distance_based,
      is_active: !!r.is_active,
    }));
    setItems(list);

    // slot codes
    const slotRes = await supabase
      .from("exercise_slot")
      .select("slot_code")
      .order("slot_code", { ascending: true });
    const codes = slotRes.error
      ? []
      : Array.from(new Set((slotRes.data ?? []).map((r: { slot_code: string }) => String(r.slot_code))));
    setSlotCodes(codes);

    if (!mapSlot && codes.length) setMapSlot(codes[0]);

    setLoading(false);
  };

  useEffect(() => {
    const removeAuthRecovery = installAuthRecovery(() => {
      setIsAuthed(false);
      setUserId("");
      setGroups([]);
      setSelectedGroupId("");
    });

    (async () => {
      const { data } = await supabase.auth.getSession();
      setIsAuthed(!!data.session);
      setUserId(data.session?.user.id ?? "");
      if (data.session?.user.id) await loadGroupsFromDb();
      setAuthReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setIsAuthed(!!session);
      setUserId(session?.user.id ?? "");
      if (session?.user.id) void loadGroupsFromDb();
      else {
        setGroups([]);
        setSelectedGroupId("");
      }
      setAuthReady(true);
    });
    return () => {
      removeAuthRecovery();
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  useEffect(() => {
  if (!selected) return;
  const category = categoryForExercise(selected);
  setEditName(selected.canonical_name);
  setEditCategory(category);
  setEditType(categoryType(category));
  setEditManual(category === "Class" ? true : selected.is_manual_only);
  setEditDistance(category === "Cardio" ? selected.is_distance_based : false);
  setEditActive(selected.is_active);

  // Fetch current slot mapping and pre-populate the dropdown
  (async () => {
    const { data, error } = await supabase
      .from("exercise_slot")
      .select("slot_code, base_weight")
      .eq("exercise_id", selected.exercise_id)
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      setMapSlot(data.slot_code);
      setMapBaseWeight(Number(data.base_weight) ?? 1);
    } else {
      // No slot mapped yet
      setMapSlot("");
      setMapBaseWeight(1);
    }
  })();
}, [selected, categoryForExercise]);

  const createExercise = async () => {
    setMsg("");
    if (!isAdmin) return setMsg("Not authorized.");

    const name = newName.trim();
    if (!name) return setMsg("Enter a name.");

    const type = categoryType(newCategory);
    const isClass = newCategory === "Class";
    const dist = newCategory === "Cardio" ? newDistance : false;

    const res = await supabase.rpc("admin_create_exercise", {
      p_canonical_name: name,
      p_exercise_type: type,
      p_is_manual_only: isClass,
      p_is_distance_based: dist,
      p_is_active: newActive,
    });

    if (res.error) return setMsg(res.error.message);

    const newId = Number(res.data);
    if (!Number.isFinite(newId)) return setMsg("Create failed: invalid return.");

    const targetGroup = groups.find((group) => norm(group.name) === norm(newCategory));
    if (!targetGroup) {
      await loadAll();
      return setMsg(`Exercise created, but the ${newCategory} category could not be found.`);
    }

    const groupUpdate = await updateExerciseGroup(
      supabase,
      targetGroup.id,
      targetGroup.name,
      [...targetGroup.exerciseIds, newId]
    );
    if (groupUpdate.error) {
      await loadAll();
      return setMsg(`Exercise created, but adding it to ${newCategory} failed: ${groupUpdate.error}`);
    }

    setNewName("");
    setNewCategory("Pull");
    setNewDistance(false);
    setNewActive(true);

    await Promise.all([loadAll(), loadGroupsFromDb()]);
    setSelectedId(newId);
    setMsg(`Exercise created in ${newCategory}.`);
  };

  const saveEdits = async () => {
    setMsg("");
    if (!isAdmin || !selected) return;

    const name = editName.trim();
    if (!name) return setMsg("Name cannot be blank.");

    const type = categoryType(editCategory);
    const isClass = editCategory === "Class";
    const dist = editCategory === "Cardio" ? editDistance : false;

    const res = await supabase.rpc("admin_update_exercise", {
      p_exercise_id: selected.exercise_id,
      p_exercise_type: type,
      p_is_manual_only: isClass ? true : editManual,
      p_is_distance_based: dist,
      p_is_active: editActive,
    });

    if (res.error) return setMsg(res.error.message);

    for (const group of groups) {
      const shouldInclude = norm(group.name) === norm(editCategory);
      const hasExercise = group.exerciseIds.includes(selected.exercise_id);
      if (shouldInclude === hasExercise) continue;

      const exerciseIds = shouldInclude
        ? [...group.exerciseIds, selected.exercise_id]
        : group.exerciseIds.filter((id) => id !== selected.exercise_id);
      const groupUpdate = await updateExerciseGroup(supabase, group.id, group.name, exerciseIds);
      if (groupUpdate.error) return setMsg(groupUpdate.error);
    }

    await Promise.all([loadAll(), loadGroupsFromDb()]);
    setSelectedId(null);
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

  const loadGroupIntoForm = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    setSelectedGroupId(groupId);
    setGroupExerciseIds(group?.exerciseIds ?? []);
    setGroupSearch("");
    setGroupPickerOpen(true);
    setMsg("");
  };

  const toggleGroupExercise = (exerciseId: number) => {
    setGroupExerciseIds((prev) =>
      prev.includes(exerciseId)
        ? prev.filter((id) => id !== exerciseId)
        : [...prev, exerciseId]
    );
  };

  const saveExerciseGroup = async () => {
    setMsg("");
    if (!userId) return setMsg("Sign in before saving groups.");

    const name = selectedGroup?.name ?? "";
    const exerciseIds = Array.from(new Set(groupExerciseIds));
    if (!selectedGroupId || !name) return setMsg("Select a category.");
    if (exerciseIds.length === 0) return setMsg("Choose at least one exercise for the group.");

    const { error } = await updateExerciseGroup(supabase, selectedGroupId, name, exerciseIds);
    if (error) return setMsg(error);
    await loadGroupsFromDb();
    setSelectedGroupId(selectedGroupId);
    setGroupPickerOpen(false);
    setMsg(`${name} category saved.`);
  };

  const signOut = () => {
    setIsAuthed(false);
    setUserId("");
    setGroups([]);
    setSelectedGroupId("");
    setMsg("");
    void localSignOut();
    router.replace("/log");
  };

  const typeLabel = (t: ExerciseType) => ({ 1: "Strength", 2: "Cardio", 3: "Other", 4: "Class" }[t] ?? "—");
  const typeBadgeClass = (t: ExerciseType) => ({ 1: "badge-blue", 2: "badge-green", 3: "badge-slate", 4: "badge-purple" }[t] ?? "badge-slate");

  // Wait for session check before deciding — prevents flash of "Please sign in"
  if (!authReady) {
    return (
      <main className="min-h-screen bg-gym-bg flex items-center justify-center">
        <div className="card text-center space-y-3">
          <svg className="animate-spin h-6 w-6 text-blue-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-slate-400">Checking session…</p>
        </div>
      </main>
    );
  }

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
      <div className="max-w-3xl mx-auto px-2 py-2 space-y-2 sm:px-4 sm:py-6 sm:space-y-5">

        {/* Header */}
        <div className="card flex items-center justify-between gap-2 flex-wrap sm:gap-4">
          <div>
            <p className="section-title">Admin</p>
            <h1 className="text-lg font-bold text-slate-100 mt-0.5 sm:text-2xl">Exercise Maintenance</h1>
          </div>
          <div className="flex gap-2">
            <Link href="/" className="btn-ghost">← Today&apos;s Plan</Link>
            <button onClick={signOut} className="btn-ghost">Sign out</button>
          </div>
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
                  <label className="label">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => {
                      const category = e.target.value as ExerciseCategory;
                      setNewCategory(category);
                      if (category !== "Cardio") setNewDistance(false);
                    }}
                    className="input"
                  >
                    {EXERCISE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end gap-6 pb-1">
                  <label className={`flex items-center gap-2 cursor-pointer text-sm ${newCategory === "Cardio" ? "text-slate-300" : "text-slate-600"}`}>
                    <input
                      type="checkbox"
                      checked={newDistance}
                      onChange={(e) => setNewDistance(e.target.checked)}
                      disabled={newCategory !== "Cardio"}
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

            {/* Exercise groups */}
            <div className="card space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="section-title">Categories</p>
                  <h2 className="text-lg font-semibold text-slate-100 mt-0.5">
                    Manage category exercises
                  </h2>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-3">
                  <p className="text-sm text-slate-400">
                    Categories ({groups.length})
                  </p>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {groups.length === 0 ? (
                      <div className="rounded-lg border border-slate-700 px-3 py-4 text-sm text-slate-500">
                        No standard categories found.
                      </div>
                    ) : (
                      groups.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => loadGroupIntoForm(g.id)}
                          className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
                            selectedGroupId === g.id
                              ? "bg-blue-900/50 border border-blue-700"
                              : "hover:bg-slate-700/50"
                          }`}
                        >
                          <span className="block font-medium text-slate-100 text-sm truncate">{g.name}</span>
                          <span className="text-xs text-slate-500">{g.exerciseIds.length} exercises</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <details
                    open={groupPickerOpen}
                    onToggle={(e) => setGroupPickerOpen(e.currentTarget.open)}
                    className="rounded-lg border border-slate-700 bg-slate-900/30 p-3"
                  >
                    <summary className="cursor-pointer text-sm font-medium text-slate-200">
                      Choose exercises ({groupExerciseIds.length} selected)
                    </summary>
                    <input
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="Search active exercises..."
                      className="input mb-2 mt-3"
                    />
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-700">
                      {filteredGroupExercises.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-slate-500">No matching active exercises.</div>
                      ) : (
                        filteredGroupExercises.map((e) => (
                          <label
                            key={e.exercise_id}
                            className="flex items-center gap-3 px-3 py-2.5 text-sm text-slate-200 cursor-pointer hover:bg-slate-700/60"
                          >
                            <input
                              type="checkbox"
                              checked={groupExerciseIds.includes(e.exercise_id)}
                              onChange={() => toggleGroupExercise(e.exercise_id)}
                              className="w-4 h-4 accent-blue-500 shrink-0"
                            />
                            <span className="flex-1 min-w-0 truncate">{e.canonical_name}</span>
                            <span className={typeBadgeClass(e.exercise_type)}>
                              {typeLabel(e.exercise_type)}
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  </details>

                  {selectedGroup && selectedGroupExerciseNames.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedGroupExerciseNames.map((name) => (
                        <span key={name} className="badge-slate">{name}</span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-sm text-slate-500">
                      {groupExerciseIds.length} selected
                    </span>
                    <button onClick={saveExerciseGroup} disabled={!selectedGroupId} className="btn-primary">
                      Save Category
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Exercise maintenance */}
            <div className="space-y-3">

              {/* Exercise list */}
              <details className="card">
                <summary className="cursor-pointer">
                  <span className="section-title">Exercises ({filtered.length})</span>
                </summary>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="input mt-3"
                />
                <div className="space-y-0.5 max-h-[40vh] lg:max-h-[520px] overflow-y-auto -mx-4 px-4">
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
              </details>

              {/* Detail / edit panel */}
              <div className="card space-y-4 sm:space-y-5">
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
                        <label className="label">Category</label>
                        <select
                          value={editCategory}
                          onChange={(e) => {
                            const category = e.target.value as ExerciseCategory;
                            setEditCategory(category);
                            setEditType(categoryType(category));
                            if (category === "Class") {
                              setEditManual(true);
                              setEditDistance(false);
                              setMapSlot("");
                            }
                            if (category !== "Cardio") setEditDistance(false);
                          }}
                          className="input"
                        >
                          {EXERCISE_CATEGORIES.map((category) => (
                            <option key={category} value={category}>{category}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex gap-6">
                        <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-sm">
                          <input
                            type="checkbox"
                            checked={editType === 4 ? true : editManual}
                            onChange={(e) => setEditManual(e.target.checked)}
                            disabled={editType === 4}
                            className="w-4 h-4 accent-blue-500"
                          />
                          Manual-only
                        </label>
                        <label className={`flex items-center gap-2 cursor-pointer text-sm ${editCategory === "Cardio" ? "text-slate-300" : "text-slate-600"}`}>
                          <input
                            type="checkbox"
                            checked={editDistance}
                            onChange={(e) => setEditDistance(e.target.checked)}
                            disabled={editCategory !== "Cardio"}
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

                    <details className="border-t border-slate-700 pt-5">
                      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-slate-500">
                        Advanced legacy slot mapping
                      </summary>

                      <div className="mt-3 flex gap-2 flex-wrap items-end">
                        <div className="flex-1 min-w-[180px]">
                          <label className="label">Slot</label>
                          <select value={mapSlot} onChange={(e) => setMapSlot(e.target.value)} disabled={editType === 4} className="input">
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
                            {...noNumericAutofillProps}
                            className="input"
                          />
                        </div>

                        <button onClick={() => void mapSlotToSelected()} disabled={editType === 4} className="btn-secondary">
                          Map
                        </button>
                      </div>
                    </details>
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

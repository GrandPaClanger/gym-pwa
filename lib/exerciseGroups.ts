"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ExerciseGroup = {
  id: string;
  name: string;
  exerciseIds: number[];
};

type ExerciseGroupRow = {
  exercise_group_id: number | string;
  name: string;
};

type ExerciseGroupItemRow = {
  exercise_group_id: number | string;
  exercise_id: number | string;
  sequence_no: number | string;
};

export async function readExerciseGroups(
  client: SupabaseClient
): Promise<{ groups: ExerciseGroup[]; error: string | null }> {
  const { data: groupRows, error: groupError } = await client
    .from("exercise_group")
    .select("exercise_group_id, name")
    .order("name", { ascending: true });

  if (groupError) return { groups: [], error: groupError.message };

  const groups = ((groupRows as ExerciseGroupRow[]) ?? []).map((g) => ({
    id: String(g.exercise_group_id),
    name: String(g.name),
    exerciseIds: [] as number[],
  }));

  if (groups.length === 0) return { groups, error: null };

  const groupIds = groups.map((g) => Number(g.id)).filter((id) => Number.isFinite(id));
  const { data: itemRows, error: itemError } = await client
    .from("exercise_group_item")
    .select("exercise_group_id, exercise_id, sequence_no")
    .in("exercise_group_id", groupIds)
    .order("sequence_no", { ascending: true });

  if (itemError) return { groups: [], error: itemError.message };

  const byGroupId = new Map(groups.map((g) => [g.id, g]));
  for (const item of (itemRows as ExerciseGroupItemRow[]) ?? []) {
    const group = byGroupId.get(String(item.exercise_group_id));
    const exerciseId = Number(item.exercise_id);
    if (group && Number.isFinite(exerciseId)) group.exerciseIds.push(exerciseId);
  }

  return { groups, error: null };
}

export async function createExerciseGroup(
  client: SupabaseClient,
  name: string,
  exerciseIds: number[]
): Promise<{ group: ExerciseGroup | null; error: string | null }> {
  const cleanedIds = Array.from(new Set(exerciseIds)).filter((id) => Number.isFinite(id));
  const { data, error } = await client
    .from("exercise_group")
    .insert({ name: name.trim() })
    .select("exercise_group_id, name")
    .single();

  if (error) return { group: null, error: error.message };

  const groupId = Number((data as ExerciseGroupRow).exercise_group_id);
  if (!Number.isFinite(groupId)) return { group: null, error: "Created group has an invalid id." };

  if (cleanedIds.length > 0) {
    const { error: itemError } = await client.from("exercise_group_item").insert(
      cleanedIds.map((exerciseId, index) => ({
        exercise_group_id: groupId,
        exercise_id: exerciseId,
        sequence_no: index + 1,
      }))
    );
    if (itemError) return { group: null, error: itemError.message };
  }

  return {
    group: { id: String(groupId), name: String((data as ExerciseGroupRow).name), exerciseIds: cleanedIds },
    error: null,
  };
}

export async function updateExerciseGroup(
  client: SupabaseClient,
  groupId: string,
  name: string,
  exerciseIds: number[]
): Promise<{ error: string | null }> {
  const numericGroupId = Number(groupId);
  const cleanedIds = Array.from(new Set(exerciseIds)).filter((id) => Number.isFinite(id));
  if (!Number.isFinite(numericGroupId)) return { error: "Invalid group id." };

  const { error: groupError } = await client
    .from("exercise_group")
    .update({ name: name.trim() })
    .eq("exercise_group_id", numericGroupId);

  if (groupError) return { error: groupError.message };

  const { error: deleteError } = await client
    .from("exercise_group_item")
    .delete()
    .eq("exercise_group_id", numericGroupId);

  if (deleteError) return { error: deleteError.message };

  if (cleanedIds.length === 0) return { error: null };

  const { error: insertError } = await client.from("exercise_group_item").insert(
    cleanedIds.map((exerciseId, index) => ({
      exercise_group_id: numericGroupId,
      exercise_id: exerciseId,
      sequence_no: index + 1,
    }))
  );

  return { error: insertError?.message ?? null };
}

export async function deleteExerciseGroup(
  client: SupabaseClient,
  groupId: string
): Promise<{ error: string | null }> {
  const numericGroupId = Number(groupId);
  if (!Number.isFinite(numericGroupId)) return { error: "Invalid group id." };

  const { error } = await client
    .from("exercise_group")
    .delete()
    .eq("exercise_group_id", numericGroupId);

  return { error: error?.message ?? null };
}

export const dynamic = "force-dynamic";

import NewStrengthExerciseClient from "./NewStrengthExerciseClient";

export default function Page({
  searchParams,
}: {
  searchParams?: { return?: string };
}) {
  const returnTo = searchParams?.return ?? "/log";
  return <NewStrengthExerciseClient returnTo={returnTo} />;
}

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  const isVercelCron = ua.includes("vercel-cron/1.0");

  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";

  if (!isVercelCron && (!expected || auth !== expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return new Response("Missing Supabase env vars", { status: 500 });

  const res = await fetch(`${url}/rest/v1/exercise?select=exercise_id&limit=1`, {
    headers: { apikey: anon, authorization: `Bearer ${anon}` },
    cache: "no-store",
  });

  if (!res.ok) return new Response(`Supabase ping failed: ${res.status}`, { status: 500 });

  return Response.json({ ok: true, ts: new Date().toISOString() });
}

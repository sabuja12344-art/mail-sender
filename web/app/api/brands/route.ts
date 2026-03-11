import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET() {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 설정 필요" },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from("brands")
    .select("id, name, website_url, email, pixel_installed, status, created_at, analysis_summary, search_keyword")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function PATCH(req: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 설정 필요" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body?.id) {
    return NextResponse.json({ error: "id 필수" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.analysis_summary === "string") updates.analysis_summary = body.analysis_summary;
  if (typeof body.status === "string") updates.status = body.status;
  if (typeof body.email === "string") updates.email = body.email;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "수정할 필드 없음" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("brands")
    .update(updates)
    .eq("id", body.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

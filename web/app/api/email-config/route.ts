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
    return NextResponse.json({ error: "환경 변수 미설정" }, { status: 500 });
  }
  const { data, error } = await supabase
    .from("email_config")
    .select("*")
    .limit(1)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function PUT(req: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "환경 변수 미설정" }, { status: 500 });
  }

  const body = await req.json();
  const { id, template_subject, template_html, from_email, inline_images } = body;

  if (!id) {
    return NextResponse.json({ error: "id 필수" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof template_subject === "string") update.template_subject = template_subject;
  if (typeof template_html === "string") update.template_html = template_html;
  if (typeof from_email === "string") update.from_email = from_email;
  if (Array.isArray(inline_images)) {
    update.inline_images = inline_images;
  }

  const { error } = await supabase
    .from("email_config")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

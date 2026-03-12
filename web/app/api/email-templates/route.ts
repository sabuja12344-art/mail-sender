import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** GET: 목록 조회. 쿼리 ?id=xxx 이면 해당 1건만 */
export async function GET(req: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "환경 변수 미설정" }, { status: 500 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const { data, error } = await supabase
      .from("email_templates")
      .select("*")
      .eq("id", id)
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from("email_templates")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(Array.isArray(data) ? data : []);
}

/** POST: 새 템플릿 생성 */
export async function POST(req: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "환경 변수 미설정" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    name,
    template_subject,
    template_html,
    from_email,
    inline_images,
    is_default,
  } = body;

  const row = {
    name: typeof name === "string" ? name : "새 템플릿",
    template_subject: typeof template_subject === "string" ? template_subject : "[제안] {{업체명}} 맞춤 마케팅 제안",
    template_html: typeof template_html === "string" ? template_html : "",
    from_email: typeof from_email === "string" ? from_email : "onboarding@resend.dev",
    inline_images: Array.isArray(inline_images) ? inline_images : [],
    is_default: !!is_default,
    updated_at: new Date().toISOString(),
  };

  if (row.is_default) {
    await supabase.from("email_templates").update({ is_default: false }).not("id", "is", null);
  }

  const { data, error } = await supabase.from("email_templates").insert(row).select("id").single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data?.id, ok: true });
}

/** PUT: 템플릿 수정 */
export async function PUT(req: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "환경 변수 미설정" }, { status: 500 });
  }

  const body = await req.json();
  const {
    id,
    name,
    template_subject,
    template_html,
    from_email,
    inline_images,
    is_default,
  } = body;

  if (!id) {
    return NextResponse.json({ error: "id 필수" }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof name === "string") update.name = name;
  if (typeof template_subject === "string") update.template_subject = template_subject;
  if (typeof template_html === "string") update.template_html = template_html;
  if (typeof from_email === "string") update.from_email = from_email;
  if (Array.isArray(inline_images)) update.inline_images = inline_images;
  if (typeof is_default === "boolean") {
    update.is_default = is_default;
    if (is_default) {
      await supabase.from("email_templates").update({ is_default: false }).neq("id", id);
    }
  }

  const { error } = await supabase.from("email_templates").update(update).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE: 템플릿 삭제. 쿼리 ?id=xxx */
export async function DELETE(req: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "환경 변수 미설정" }, { status: 500 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id 쿼리 필수" }, { status: 400 });
  }
  const { error } = await supabase.from("email_templates").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

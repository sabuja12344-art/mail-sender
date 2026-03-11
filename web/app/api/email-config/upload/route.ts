import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BUCKET = "email-assets";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function POST(req: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "환경 변수 미설정" }, { status: 500 });
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "multipart/form-data 필요" }, { status: 400 });
  }

  let file: File;
  let contentId: string;
  try {
    const formData = await req.formData();
    file = formData.get("file") as File;
    contentId = (formData.get("content_id") as string) || "img";
    if (!file || !file.size) {
      return NextResponse.json({ error: "file 필수" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const safeId = contentId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "img";
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${Date.now()}-${safeId}.${ext}`;

  const buf = await file.arrayBuffer();
  const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    if (error.message?.includes("Bucket not found") || error.message?.includes("not found")) {
      try {
        await supabase.storage.createBucket(BUCKET, { public: true });
      } catch {
        return NextResponse.json(
          { error: `Storage 버킷 '${BUCKET}'이 없습니다. Supabase 대시보드 → Storage → New bucket → 이름: email-assets, Public 체크 후 생성하세요.` },
          { status: 400 }
        );
      }
      const retry = await supabase.storage.from(BUCKET).upload(path, buf, {
        contentType: file.type,
        upsert: false,
      });
      if (retry.error) {
        return NextResponse.json({ error: retry.error.message }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({
    url: urlData.publicUrl,
    content_id: safeId,
    path,
  });
}

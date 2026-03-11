import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!baseUrl || !key) {
    return NextResponse.json(
      { error: "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 설정 필요" },
      { status: 500 }
    );
  }

  const fnUrl = `${baseUrl.replace(/\/$/, "")}/functions/v1/generate-proposals`;

  try {
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });

    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }

    if (!res.ok) {
      const errMsg = body.error || body.raw || `Edge Function 오류 (${res.status})`;
      return NextResponse.json({ error: errMsg, detail: body }, { status: res.status });
    }

    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json(
      { error: `Edge Function 호출 실패: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}

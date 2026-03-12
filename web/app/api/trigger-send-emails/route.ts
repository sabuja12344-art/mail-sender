import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!baseUrl || !key) {
    return NextResponse.json(
      { error: "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 설정 필요" },
      { status: 500 }
    );
  }

  let body: { brandIds?: string[]; templateId?: string; fromEmail?: string } = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch { /* ignore */ }

  const fnUrl = `${baseUrl.replace(/\/$/, "")}/functions/v1/send-proposal-emails`;
  const payload: { brandIds?: string[]; templateId?: string; fromEmail?: string } = {};
  if (Array.isArray(body?.brandIds) && body.brandIds.length > 0) payload.brandIds = body.brandIds;
  if (typeof body?.templateId === "string" && body.templateId.trim()) payload.templateId = body.templateId.trim();
  if (typeof body?.fromEmail === "string" && body.fromEmail.trim()) payload.fromEmail = body.fromEmail.trim();

  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let responseBody: unknown;
  try {
    responseBody = text ? JSON.parse(text) : {};
  } catch {
    responseBody = { raw: text };
  }

  if (!res.ok) {
    return NextResponse.json(responseBody ?? { error: text }, { status: res.status });
  }

  return NextResponse.json(responseBody);
}

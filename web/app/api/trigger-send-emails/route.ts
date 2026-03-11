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

  const fnUrl = `${baseUrl.replace(/\/$/, "")}/functions/v1/send-proposal-emails`;

  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    return NextResponse.json(body ?? { error: text }, { status: res.status });
  }

  return NextResponse.json(body);
}

import { NextRequest, NextResponse } from "next/server";

/**
 * 크롤러 서버(ngrok/localhost)로 서버사이드 프록시.
 * 브라우저가 ngrok을 직접 호출하면 CORS 차단되므로,
 * 이 Route가 중간에서 대신 호출합니다.
 *
 * GET  /api/crawler-proxy?url=<encodedUrl>&path=health
 * POST /api/crawler-proxy?url=<encodedUrl>&path=run  (body 그대로 전달)
 */

const NGROK_HEADERS = {
  "ngrok-skip-browser-warning": "true",
  "User-Agent": "MailSenderDashboard/1.0",
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const baseUrl = searchParams.get("url");
  const path = searchParams.get("path") || "health";

  if (!baseUrl) {
    return NextResponse.json({ error: "url 파라미터가 필요합니다." }, { status: 400 });
  }

  try {
    const target = `${baseUrl.replace(/\/+$/, "")}/${path}`;
    const res = await fetch(target, {
      headers: NGROK_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const baseUrl = searchParams.get("url");
  const path = searchParams.get("path") || "run";

  if (!baseUrl) {
    return NextResponse.json({ error: "url 파라미터가 필요합니다." }, { status: 400 });
  }

  try {
    const body = await req.text();
    const target = `${baseUrl.replace(/\/+$/, "")}/${path}`;
    const res = await fetch(target, {
      method: "POST",
      headers: {
        ...NGROK_HEADERS,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(600000), // 크롤링은 최대 10분
    });
    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status });
    } catch {
      return new NextResponse(text, { status: res.status });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}

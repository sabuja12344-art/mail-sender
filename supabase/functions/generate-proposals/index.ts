// Supabase Edge Function: AI 개인화 제안서 생성 (Gemini API)
// - status='수집완료'인 brands 조회 → Gemini로 맞춤 제안 생성 → analysis_summary 업데이트, status='제안생성'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface BrandRow {
  id: string;
  name: string;
  website_url: string | null;
  email: string | null;
  pixel_installed: boolean;
  analysis_summary: string | null;
  status: string;
}

function buildPrompt(brandName: string, pixelInstalled: boolean): string {
  const pixelStatus = pixelInstalled ? "True" : "False";
  return `너는 4년 차 퍼포먼스 마케터야. ${brandName} 대상으로, pixel_installed가 ${pixelStatus}일 때 ${pixelInstalled ? "전환 최적화(CRO) 측면의 제안" : "리타겟팅 광고 부재를 지적하는 제안"}을 담은 실제 영업 제안 메일을 작성해줘.

【반드시 지킬 사항】
1. 인사말: 반드시 "원애드 김준호 마케터입니다"를 포함해서 시작해줘.
2. 본문: 간결하고 임팩트 있는 문장만 사용하고, 군더더기 없이 핵심만 전달해줘.
3. 가독성: 본문은 최소 20줄 이상으로 작성하고, 단락·줄바꿈을 활용해 읽기 쉽게 구성해줘.
4. 어휘: 실제 B2B 제안 메일에서 쓰는 격식 있고 신뢰감 있는 표현을 사용해줘. (예: 검토 부탁드립니다, 협력 제안, 도움이 되고자 등)

응답 형식은 반드시 다음처럼 해줘:
---
제목: (한 줄)
---
본문:
(인사말에 '원애드 김준호 마케터입니다' 포함, 본문 최소 20줄, 가독성 있게)
`;
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  if (!text) {
    const blockReason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? "unknown";
    throw new Error(`Gemini 빈 응답 (reason: ${blockReason})`);
  }
  return text;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Supabase env not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!geminiApiKey) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY secret not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: brands, error: fetchError } = await supabase
      .from("brands")
      .select("id, name, website_url, email, pixel_installed, analysis_summary, status")
      .eq("status", "수집완료")
      .not("email", "is", null)
      .neq("email", "");

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch brands", detail: fetchError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const list = (brands ?? []) as BrandRow[];
    if (list.length === 0) {
      return new Response(
        JSON.stringify({ message: "이메일이 있는 수집완료 브랜드가 없습니다.", updated: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    let updated = 0;
    const errors: string[] = [];
    const toProcess = list.slice(0, 50);
    const DELAY_MS = 2500; // 429 방지: 요청 간 2.5초 대기 (무료 한도 준수)

    for (let i = 0; i < toProcess.length; i++) {
      const brand = toProcess[i];
      try {
        const prompt = buildPrompt(brand.name, brand.pixel_installed);
        const analysisSummary = await callGemini(geminiApiKey, prompt);

        const { error: updateError } = await supabase
          .from("brands")
          .update({
            analysis_summary: analysisSummary,
            status: "제안생성",
          })
          .eq("id", brand.id);

        if (updateError) {
          errors.push(`${brand.name}: DB 업데이트 실패 - ${updateError.message}`);
        } else {
          updated++;
        }
      } catch (e) {
        const msg = (e as Error).message;
        errors.push(`${brand.name}: ${msg}`);
        if (msg.includes("429") && errors.filter((x) => x.includes("429")).length >= 2) {
          errors.push("할당량 초과(429)로 중단. 잠시 후 다시 실행하거나 요금제를 확인하세요.");
          break;
        }
        if (!msg.includes("429") && errors.length >= 3 && updated === 0) {
          errors.push(`첫 ${i + 1}건 모두 실패하여 중단합니다. API 키를 확인하세요.`);
          break;
        }
      }
      if (i < toProcess.length - 1) await sleep(DELAY_MS);
    }

    return new Response(
      JSON.stringify({
        message: `전체 ${list.length}건 중 ${toProcess.length}건 처리`,
        updated,
        errors: errors.length ? errors : undefined,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

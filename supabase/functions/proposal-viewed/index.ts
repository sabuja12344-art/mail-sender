// Supabase Edge Function: 제안서 상세보기 웹훅
// 메일 내 '제안서 상세보기' 링크 클릭 시 호출 → 해당 브랜드 status를 '확인완료'로 업데이트 후 리다이렉트

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  const redirectUrl =
    Deno.env.get("PROPOSAL_VIEWED_REDIRECT_URL") ||
    "https://example.com/thank-you"; // Edge Function 시크릿으로 설정 권장

  const url = new URL(req.url);
  const brandId = url.searchParams.get("brand_id");

  if (!brandId || !brandId.trim()) {
    return new Response(
      "<html><body><p>잘못된 링크입니다. brand_id가 없습니다.</p></body></html>",
      {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      "<html><body><p>서버 설정 오류입니다.</p></body></html>",
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase
    .from("brands")
    .update({ status: "확인완료" })
    .eq("id", brandId.trim());

  if (error) {
    return new Response(
      `<html><body><p>상태 업데이트 실패: ${error.message}</p></body></html>`,
      {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }

  // 302 리다이렉트: 감사 페이지 또는 제안서 상세 페이지로 이동
  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
});

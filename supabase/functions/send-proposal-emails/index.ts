// Supabase Edge Function: 발송대기 브랜드에게 템플릿 기반 메일 발송 (Resend)
// - email_config 테이블에서 템플릿·발신 주소 로드
// - status='발송대기'인 brands 조회 → 메일 발송 → status='발송완료'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const RESEND_API = "https://api.resend.com/emails";

interface BrandRow {
  id: string;
  name: string;
  email: string | null;
  website_url: string | null;
  status: string;
}

interface InlineImage {
  content_id: string;
  url: string;
  width?: number;
  height?: number;
}

interface EmailConfig {
  template_subject: string;
  template_html: string;
  from_email: string;
  inline_images?: InlineImage[];
}

function replacePlaceholders(template: string, brand: BrandRow): string {
  return template
    .replace(/\{\{업체명\}\}/g, escapeHtml(brand.name))
    .replace(/\{\{brand_name\}\}/g, escapeHtml(brand.name))
    .replace(/\{\{웹사이트\}\}/g, escapeHtml(brand.website_url || ""))
    .replace(/\{\{website_url\}\}/g, escapeHtml(brand.website_url || ""));
}

function injectImageDimensions(html: string, inlineImages: InlineImage[]): string {
  if (!Array.isArray(inlineImages)) return html;
  let result = html;
  for (const img of inlineImages) {
    if (!img?.content_id) continue;
    const cid = img.content_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dims: string[] = [];
    if (img.width && img.width > 0) dims.push(`width="${img.width}"`);
    if (img.height && img.height > 0) dims.push(`height="${img.height}"`);
    if (dims.length === 0) continue;
    const re = new RegExp(`(<img)([^>]*)(src=["']cid:${cid}["'])([^>]*)(>)`, "gi");
    result = result.replace(re, (_, open, before, src, after, close) =>
      `${open}${before} ${dims.join(" ")} ${src}${after}${close}`
    );
  }
  return result;
}

function buildFullHtml(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; line-height: 1.7; color: #333; max-width: 640px; margin: 0 auto; padding: 24px;">
${bodyHtml}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildAttachments(inlineImages: InlineImage[]): { filename: string; path: string; content_id: string }[] {
  if (!Array.isArray(inlineImages) || inlineImages.length === 0) return [];
  return inlineImages
    .filter((img) => img?.content_id && img?.url)
    .map((img) => {
      const ext = img.url.split(".").pop()?.split("?")[0]?.toLowerCase();
      const safeExt = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext || "") ? ext : "png";
      return {
        filename: `${img.content_id}.${safeExt}`,
        path: img.url,
        content_id: img.content_id,
      };
    });
}

async function sendViaResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  attachments: { filename: string; path: string; content_id: string }[] = []
): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, unknown> = { from, to, subject, html };
  if (attachments.length > 0) body.attachments = attachments;

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text}` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
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
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Supabase env not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!resendApiKey) {
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY secret not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // 1) 이메일 설정(템플릿 + 발신 주소) 로드
    const { data: configData, error: configError } = await supabase
      .from("email_config")
      .select("template_subject, template_html, from_email, inline_images")
      .limit(1)
      .single();

    if (configError || !configData) {
      return new Response(
        JSON.stringify({
          error: "email_config 테이블을 읽을 수 없습니다. SQL을 실행했는지 확인하세요.",
          detail: configError?.message,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const config = configData as EmailConfig;
    const fromEmail = config.from_email || "onboarding@resend.dev";

    if (!config.template_html || !config.template_html.trim()) {
      return new Response(
        JSON.stringify({ error: "이메일 템플릿이 비어 있습니다. 대시보드에서 템플릿을 작성해 주세요." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2) 발송대기 브랜드 조회
    const { data: brands, error: fetchError } = await supabase
      .from("brands")
      .select("id, name, email, website_url, status")
      .eq("status", "발송대기");

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: "브랜드 조회 실패", detail: fetchError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const list = (brands ?? []) as BrandRow[];
    const toSend = list.filter((b) => b.email && b.email.trim());
    const noEmail = list.length - toSend.length;

    if (toSend.length === 0) {
      return new Response(
        JSON.stringify({
          message: list.length === 0
            ? "발송대기 상태의 브랜드가 없습니다."
            : "이메일이 있는 발송대기 브랜드가 없습니다.",
          sent: 0,
          skipped_no_email: noEmail,
        }),
        { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    // 3) 메일 발송
    let sent = 0;
    const errors: string[] = [];

    const attachments = buildAttachments(config.inline_images || []);

    for (const brand of toSend) {
      const email = (brand.email ?? "").trim();
      const subject = replacePlaceholders(config.template_subject, brand);
      let bodyHtml = replacePlaceholders(config.template_html, brand);
      bodyHtml = injectImageDimensions(bodyHtml, config.inline_images || []);
      const html = buildFullHtml(bodyHtml);

      const result = await sendViaResend(resendApiKey, fromEmail, email, subject, html, attachments);

      if (!result.ok) {
        errors.push(`${brand.name}: ${result.error}`);
        continue;
      }

      const { error: updateError } = await supabase
        .from("brands")
        .update({ status: "발송완료" })
        .eq("id", brand.id);

      if (updateError) {
        errors.push(`${brand.name} (메일 발송됨, DB 업데이트 실패): ${updateError.message}`);
      } else {
        sent++;
      }
    }

    return new Response(
      JSON.stringify({
        message: `${toSend.length}건 처리, ${sent}건 발송 완료`,
        sent,
        skipped_no_email: noEmail,
        errors: errors.length ? errors : undefined,
      }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

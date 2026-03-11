-- 이메일 발송 설정 테이블 (한 번에 실행용)
-- Supabase SQL Editor에서 이 파일 내용 전체 복사 후 Run

CREATE TABLE IF NOT EXISTS public.email_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_subject TEXT NOT NULL DEFAULT '[제안] {{업체명}} 맞춤 마케팅 제안',
  template_html TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT 'onboarding@resend.dev',
  inline_images JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.email_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.email_config;
CREATE POLICY "service_role full access" ON public.email_config
  FOR ALL USING (true) WITH CHECK (true);

-- 기존 행이 없을 때만 초기 데이터 삽입
INSERT INTO public.email_config (template_subject, template_html, from_email, inline_images)
SELECT
  '[제안] {{업체명}} 맞춤 마케팅 제안',
  '<h2>{{업체명}} 담당자님께</h2>
<p>안녕하세요, 원애드 김준호 마케터입니다.</p>
<p>귀사의 온라인 마케팅 성과 향상을 위해 맞춤 제안을 드립니다.</p>
<br>
<p>상세 내용은 아래 버튼을 통해 확인해 주세요.</p>
<p>감사합니다.</p>',
  'onboarding@resend.dev',
  '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.email_config LIMIT 1);

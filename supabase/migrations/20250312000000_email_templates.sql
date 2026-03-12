-- 여러 명이 사용할 수 있도록 메일 양식 템플릿 여러 개 지원
CREATE TABLE IF NOT EXISTS public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '기본 템플릿',
  template_subject TEXT NOT NULL DEFAULT '[제안] {{업체명}} 맞춤 마케팅 제안',
  template_html TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT 'onboarding@resend.dev',
  inline_images JSONB NOT NULL DEFAULT '[]',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access email_templates" ON public.email_templates
  FOR ALL USING (true) WITH CHECK (true);

-- 기존 email_config 데이터를 템플릿 1개로 이전 (한 번만)
INSERT INTO public.email_templates (name, template_subject, template_html, from_email, inline_images, is_default)
SELECT
  '기본 템플릿',
  COALESCE(ec.template_subject, '[제안] {{업체명}} 맞춤 마케팅 제안'),
  COALESCE(ec.template_html, ''),
  COALESCE(ec.from_email, 'onboarding@resend.dev'),
  COALESCE(ec.inline_images, '[]'::jsonb),
  true
FROM public.email_config ec
LIMIT 1;

-- 이전된 행이 없으면 기본 행 1개 삽입
INSERT INTO public.email_templates (name, template_subject, template_html, from_email, inline_images, is_default)
SELECT
  '기본 템플릿',
  '[제안] {{업체명}} 맞춤 마케팅 제안',
  '<h2>{{업체명}} 담당자님께</h2>
<p>안녕하세요, 원애드 김준호 마케터입니다.</p>
<p>귀사의 온라인 마케팅 성과 향상을 위해 맞춤 제안을 드립니다.</p>
<br>
<p>상세 내용은 아래 버튼을 통해 확인해 주세요.</p>
<p>감사합니다.</p>',
  'onboarding@resend.dev',
  '[]'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.email_templates LIMIT 1);

COMMENT ON TABLE public.email_templates IS '메일 발송용 템플릿 여러 개 (발송 시 선택)';

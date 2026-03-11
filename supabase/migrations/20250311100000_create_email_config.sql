-- 이메일 발송 설정 테이블 (템플릿 + 발신 주소)
CREATE TABLE IF NOT EXISTS public.email_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_subject TEXT NOT NULL DEFAULT '[제안] {{업체명}} 맞춤 마케팅 제안',
  template_html TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT 'onboarding@resend.dev',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.email_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON public.email_config
  FOR ALL USING (true) WITH CHECK (true);

-- 초기 기본 행 삽입
INSERT INTO public.email_config (template_subject, template_html, from_email)
VALUES (
  '[제안] {{업체명}} 맞춤 마케팅 제안',
  '<h2>{{업체명}} 담당자님께</h2>
<p>안녕하세요, 원애드 김준호 마케터입니다.</p>
<p>귀사의 온라인 마케팅 성과 향상을 위해 맞춤 제안을 드립니다.</p>
<br>
<p>상세 내용은 아래 버튼을 통해 확인해 주세요.</p>
<p>감사합니다.</p>',
  'onboarding@resend.dev'
);

-- email_config에 인라인 이미지 메타 저장 (content_id → Storage URL)
ALTER TABLE public.email_config
  ADD COLUMN IF NOT EXISTS inline_images JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN public.email_config.inline_images IS '인라인 이미지 [{ "content_id": "logo", "url": "https://..." }]';

-- Storage 버킷: 이메일 첨부/인라인 이미지 (대시보드에서 수동 생성 가능)
-- Supabase 대시보드 → Storage → New bucket → 이름: email-assets, Public: true
-- 아래는 SQL로 버킷 정책만 추가 (버킷이 이미 있다고 가정)
-- 버킷이 없으면 대시보드에서 'email-assets' 이름으로 public 버킷 생성 후 사용

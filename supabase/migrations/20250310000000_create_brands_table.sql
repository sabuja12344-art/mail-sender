-- brands 테이블: 브랜드 정보 및 발송 상태 관리
-- Supabase 데이터베이스 스키마

-- enum: status 값 제한 (선택 사항, 일관성 보장)
CREATE TYPE brand_status AS ENUM (
  '수집완료',
  '제안생성',
  '발송대기',
  '발송완료',
  '회신완료'
);

-- brands 테이블 생성
CREATE TABLE public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  website_url TEXT,
  email TEXT,
  pixel_installed BOOLEAN NOT NULL DEFAULT false,
  analysis_summary TEXT,
  status brand_status NOT NULL DEFAULT '수집완료',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 인덱스: 상태별 조회, 생성일 정렬
CREATE INDEX idx_brands_status ON public.brands (status);
CREATE INDEX idx_brands_created_at ON public.brands (created_at DESC);

-- RLS(Row Level Security) 활성화 (Supabase 권장)
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

-- 정책 예시: 인증된 사용자만 모든 작업 허용 (실제 권한은 프로젝트에 맞게 수정)
CREATE POLICY "Allow authenticated users full access to brands"
  ON public.brands
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 서비스 역할(백엔드) 전체 접근 정책 (필요 시)
CREATE POLICY "Allow service role full access to brands"
  ON public.brands
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 코멘트
COMMENT ON TABLE public.brands IS '수집된 브랜드 정보와 발송 상태 관리';
COMMENT ON COLUMN public.brands.name IS '브랜드명';
COMMENT ON COLUMN public.brands.website_url IS '웹사이트 주소';
COMMENT ON COLUMN public.brands.email IS '추출된 대표 이메일';
COMMENT ON COLUMN public.brands.pixel_installed IS '픽셀 설치 여부';
COMMENT ON COLUMN public.brands.analysis_summary IS 'AI가 분석한 브랜드 약점/특징';
COMMENT ON COLUMN public.brands.status IS '상태: 수집완료 / 제안생성 / 발송대기 / 발송완료 / 회신완료';
COMMENT ON COLUMN public.brands.created_at IS '수집 일자';

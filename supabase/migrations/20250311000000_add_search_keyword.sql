-- brands 테이블에 검색 키워드 컬럼 추가
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS search_keyword TEXT;
CREATE INDEX IF NOT EXISTS idx_brands_search_keyword ON public.brands (search_keyword);
COMMENT ON COLUMN public.brands.search_keyword IS '수집 시 사용한 검색 키워드';

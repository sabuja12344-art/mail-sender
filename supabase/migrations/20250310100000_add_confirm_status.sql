-- status에 '확인완료' 추가 (제안서 상세보기 클릭 시 웹훅에서 사용)
-- PostgreSQL 15+ 인 경우: ADD VALUE IF NOT EXISTS '확인완료' 사용 가능
ALTER TYPE brand_status ADD VALUE '확인완료';

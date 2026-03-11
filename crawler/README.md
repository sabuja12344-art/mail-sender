# 온라인 브랜드 크롤러

Python + Playwright로 네이버 쇼핑·웹 검색 결과에서 브랜드 URL을 수집하고,  
이메일·픽셀 설치 여부를 확인한 뒤 Supabase `brands` 테이블에 저장합니다.

## 조건

- **제외**: 네이버 플레이스(지도), 오프라인 매장 관련 결과
- **수집**: 브랜드명, URL, 페이지 내 이메일(regex)
- **픽셀**: HTML 소스에서 `GTM`, `FB Pixel`, `Kakao Pixel` 존재 여부로 `pixel_installed` 판별

## 설치

```bash
# 프로젝트 루트에서
cd "c:\Users\PC\Desktop\영업 메일링"
pip install -r requirements.txt
playwright install chromium
```

## 실행

```bash
# 기본 키워드 "자사몰"로 수집 (최대 20개 사이트)
python crawler/brand_crawler.py

# 키워드 지정
python crawler/brand_crawler.py 여성의류
python crawler/brand_crawler.py 골프 브랜드
```

## 환경 변수

프로젝트 루트의 `.env`에 다음이 있어야 합니다.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

## 동작 요약

1. 네이버 쇼핑 검색 (`search.shopping.naver.com`) 에서 링크 수집
2. 네이버 웹 검색 (`where=web`) 에서 링크 수집 (플레이스 제외)
3. 수집된 URL 각각 방문 → 이메일 추출, 픽셀 키워드 검사, 브랜드명 추출
4. `brands` 테이블에 `status='수집완료'` 로 insert

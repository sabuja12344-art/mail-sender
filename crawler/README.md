# 온라인 브랜드 크롤러

Python + Playwright로 네이버 쇼핑·웹 검색 결과에서 브랜드 URL을 수집하고,  
이메일·픽셀 설치 여부를 확인한 뒤 Supabase `brands` 테이블에 저장합니다.

---

## 🌐 Vercel 사이트에서 "수집 실행" 쓰려면 (크롤러 서비스 배포)

Vercel에는 Python이 없어서 **크롤러 전용 서비스**를 한 번 배포한 뒤, Vercel에서 그 API를 부르도록 연결해야 합니다.

### 1) 크롤러 서비스 배포 (Railway 추천, 무료 티어 가능)

1. [Railway](https://railway.app) 로그인 후 **New Project** → **Deploy from GitHub repo** 선택 후 이 저장소 연결.
2. **Add Service** → **GitHub Repo** → 해당 저장소 선택.
3. 설정에서:
   - **Root Directory**: 비움 (프로젝트 루트)
   - **Dockerfile Path**: `Dockerfile.crawler`
   - **Start Command**: 비움 (Dockerfile CMD 사용)
4. **Variables**에 환경 변수 추가:
   - `SUPABASE_URL` = (Supabase 대시보드 URL)
   - `SUPABASE_SERVICE_ROLE_KEY` = (Supabase service_role 키)
   - (선택) `CRAWLER_SERVICE_SECRET` = 아무 비밀 문자열 (Vercel과 동일하게 설정 시 인증용)
5. 배포 후 **Settings** → **Networking** → **Generate Domain** 으로 URL 확인 (예: `https://xxx.up.railway.app`).

### 2) Vercel 환경 변수 설정

Vercel 프로젝트 → **Settings** → **Environment Variables** 에 추가:

| 이름 | 값 |
|------|-----|
| `CRAWLER_SERVICE_URL` | Railway에서 준 URL (예: `https://xxx.up.railway.app`) |
| `CRAWLER_SERVICE_SECRET` | (선택) 1)에서 넣은 것과 동일한 문자열 |

저장 후 Vercel 재배포하면, **어디서 접속해도** 대시보드의 "수집 실행"이 동작합니다.

---

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

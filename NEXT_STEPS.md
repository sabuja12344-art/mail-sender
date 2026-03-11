# 다음 단계 (영업 메일링 프로젝트)

## 1. Supabase에 테이블 생성하기

`brands` 테이블이 아직 없다면, 아래 중 하나로 마이그레이션을 적용하세요.

### 방법 A: Supabase 대시보드 (가장 간단)

1. [Supabase 대시보드](https://supabase.com/dashboard) 로그인
2. 프로젝트 **rchflauwrrlfefxzbts** 선택
3. 왼쪽 메뉴 **SQL Editor** 클릭
4. `supabase/migrations/20250310000000_create_brands_table.sql` 파일 내용 전체 복사
5. 에디터에 붙여넣기 후 **Run** 실행

### 방법 B: Supabase CLI

```bash
# CLI 설치 후 (없다면: npm i -g supabase)
cd "c:\Users\PC\Desktop\영업 메일링"
supabase link --project-ref rchflauwrrlfefxzbts
supabase db push
```

---

## 2. 앱/스크립트 환경 정하기

아래 중 하나를 선택하면, 그에 맞춰 Supabase 연동 코드를 만들어 줄 수 있어요.

| 옵션 | 설명 |
|------|------|
| **웹 앱 (React/Next.js)** | 대시보드 UI로 브랜드 목록·상태 관리 |
| **Node.js 스크립트** | 크롤링/이메일 추출 후 DB 저장 자동화 |
| **둘 다** | 스크립트로 수집 → 웹에서 확인·발송 관리 |

원하는 옵션을 알려주세요.

---

## 3. 이어서 할 수 있는 작업

- **Supabase 클라이언트 설정**  
  `.env`의 `SUPABASE_URL`, `SUPABASE_ANON_KEY`를 쓰는 초기화 코드 작성  
- **brands CRUD**  
  브랜드 추가·수정·상태 변경·목록 조회 API/함수 구현  
- **추가 테이블**  
  이메일 발송 이력, 제안서 초안 등 필요한 테이블 설계 및 마이그레이션 추가  

---

## 체크리스트

- [ ] Supabase SQL Editor에서 `brands` 테이블 생성 완료
- [ ] 사용할 스택 선택 (웹 / 스크립트 / 둘 다)
- [ ] Supabase 클라이언트 연동 및 brands CRUD 구현

원하는 **2번 옵션**(웹 / 스크립트 / 둘 다)을 알려주시면, 그 기준으로 다음 단계 코드까지 구체적으로 작성해 드리겠습니다.

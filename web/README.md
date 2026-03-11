# 영업 메일링 운영 대시보드

브랜드 목록 조회, **AI 제안 생성**, **메일 발송** 실행을 한 화면에서 할 수 있는 웹 앱입니다.

## 로컬 실행

1. 환경 변수 설정  
   `web` 폴더에 `.env.local` 파일을 만들고 아래 값을 채웁니다.
   ```env
   SUPABASE_URL=https://rchflauwrrlfefxzbtks.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=서비스_롤_키
   ```
   서비스 롤 키: Supabase 대시보드 → **Settings → API** → `service_role` (secret).

2. 의존성 설치 및 실행
   ```bash
   cd web
   npm install
   npm run dev
   ```
3. 브라우저에서 **http://localhost:3000** 접속.

## 배포 (Vercel)

1. [Vercel](https://vercel.com) 로그인 후 **New Project** → 이 저장소 연결(또는 `web` 폴더 업로드).
2. **Root Directory** 를 `web` 으로 지정.
3. **Environment Variables** 에 다음 추가:
   - `SUPABASE_URL` = `https://rchflauwrrlfefxzbtks.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = (Supabase 서비스 롤 키)
4. **Deploy** 후 발급되는 URL(예: `https://영업메일링-xxx.vercel.app`)로 접속하면 서비스 운영 가능.

## 제공 기능

- **브랜드 목록**: Supabase `brands` 테이블 조회 (상태별 개수 표시).
- **AI 제안 생성**: `status='수집완료'` 인 브랜드에 대해 Gemini로 제안 생성 후 `제안생성`으로 변경.
- **메일 발송**: `status='발송대기'` 인 브랜드에게 Resend로 제안서 메일 발송 후 `발송완료`로 변경.

발송할 브랜드는 Supabase **Table Editor**에서 해당 행의 `status` 를 **발송대기**로 수동 변경한 뒤 메일 발송 버튼을 누르면 됩니다.

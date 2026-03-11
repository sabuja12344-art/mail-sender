# Step 3: 자동 메일 발송 + 제안서 상세보기 웹훅

## 개요

- **send-proposal-emails**: `status='발송대기'` 인 브랜드에게 Resend로 제안서 메일 발송 → 발송 후 `발송완료`로 변경
- **proposal-viewed**: 메일 내 "제안서 상세보기" 링크 클릭 시 호출 → 해당 브랜드 `status`를 `확인완료`로 업데이트 후 리다이렉트

## 사전 준비

### 1. DB에 `확인완료` 상태 추가

Supabase **SQL Editor**에서 한 번 실행:

```sql
ALTER TYPE brand_status ADD VALUE '확인완료';
```

(이미 실행했다면 생략. 두 번 실행하면 오류 발생.)

### 2. Resend 설정

1. [Resend](https://resend.com) 가입 후 API 키 발급
2. Supabase 대시보드 → **Project Settings → Edge Functions → Secrets** 에 추가:
   - `RESEND_API_KEY`: `re_xxxx` 형태의 API 키
   - `RESEND_FROM_EMAIL`: 발신 주소 (Resend 인증 도메인 또는 `onboarding@resend.dev`)

### 3. (선택) 클릭 후 리다이렉트 URL

제안서 상세보기 클릭 후 이동할 페이지가 있으면:

- Secret 추가: `PROPOSAL_VIEWED_REDIRECT_URL` = `https://your-site.com/thank-you`

없으면 기본값 `https://example.com/thank-you` 로 리다이렉트됩니다.

## 배포

```bash
cd "c:\Users\PC\Desktop\영업 메일링"
npx supabase functions deploy send-proposal-emails
npx supabase functions deploy proposal-viewed
```

## 호출 순서

1. **메일 발송**  
   대시보드 **Edge Functions → send-proposal-emails → Invoke**  
   또는:
   ```bash
   curl -X POST "https://<project-ref>.supabase.co/functions/v1/send-proposal-emails" \
     -H "Authorization: Bearer <ANON_KEY>"
   ```
2. 수신자가 메일에서 **제안서 상세보기** 클릭  
   → `proposal-viewed` 가 `?brand_id=UUID` 로 호출됨  
   → DB에서 해당 브랜드 `status` = `확인완료`  
   → 설정한 URL로 리다이렉트

## 웹훅 연동 요약

| 단계 | 동작 |
|------|------|
| 메일 본문 | `analysis_summary` + 버튼 "제안서 상세보기" |
| 버튼 링크 | `https://<project-ref>.supabase.co/functions/v1/proposal-viewed?brand_id=<brand.id>` |
| 클릭 시 | GET 요청 → `brands.status` = `확인완료` → 리다이렉트 |

`send-proposal-emails` 가 위 링크를 자동으로 생성하므로, 별도 연동 코드는 필요 없습니다.

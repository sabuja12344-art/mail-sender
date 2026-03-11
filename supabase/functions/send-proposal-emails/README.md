# Edge Function: send-proposal-emails

`status='발송대기'` 인 브랜드에게 **Resend**로 제안서 메일을 발송하고, 발송 후 `status`를 `발송완료`로 업데이트합니다.

## 로직

1. `brands` 테이블에서 `status = '발송대기'` 이고 `email` 이 있는 행 조회
2. 각 브랜드에 대해:
   - 메일 본문에 `analysis_summary` 포함
   - 본문 안에 **제안서 상세보기** 링크 삽입 → 클릭 시 `proposal-viewed` 웹훅 호출 (`?brand_id=UUID`)
3. Resend API로 메일 발송
4. 발송 성공 시 해당 행의 `status`를 `발송완료`로 변경

## 필수 Secret (Supabase Edge Function Secrets)

| 이름 | 설명 |
|------|------|
| `RESEND_API_KEY` | [Resend](https://resend.com) 대시보드에서 발급한 API 키 (`re_` 로 시작) |
| `RESEND_FROM_EMAIL` | 발신 이메일 주소 (Resend에서 인증한 도메인 또는 `onboarding@resend.dev`) |

## 배포

```bash
npx supabase functions deploy send-proposal-emails
```

## 호출

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/send-proposal-emails" \
  -H "Authorization: Bearer <ANON_KEY 또는 SERVICE_ROLE_KEY>"
```

또는 대시보드 **Edge Functions → send-proposal-emails → Invoke**.

## SMTP 대안

Resend 대신 일반 SMTP를 쓰려면 Edge Function 내부를 수정해 **Nodemailer** 또는 `fetch`로 SMTP 릴레이(예: Gmail, SendGrid SMTP)를 호출하도록 구현할 수 있습니다. Resend는 API 키만 있으면 별도 SMTP 설정 없이 사용 가능합니다.

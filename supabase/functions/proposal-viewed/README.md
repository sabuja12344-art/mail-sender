# Edge Function: proposal-viewed (웹훅)

메일 안의 **제안서 상세보기** 링크 클릭 시 호출되는 웹훅입니다.

## 로직

1. 쿼리 파라미터 `brand_id` (UUID) 수신
2. `brands` 테이블에서 해당 `id` 행의 `status`를 **`확인완료`** 로 업데이트
3. `PROPOSAL_VIEWED_REDIRECT_URL` 로 **302 리다이렉트** (감사 페이지 등)

## 링크 형식

메일에서 사용되는 URL 예:

```
https://<project-ref>.supabase.co/functions/v1/proposal-viewed?brand_id=<UUID>
```

`send-proposal-emails` 함수가 위 형식으로 링크를 자동 생성합니다.

## 선택 Secret

| 이름 | 설명 |
|------|------|
| `PROPOSAL_VIEWED_REDIRECT_URL` | 클릭 후 이동할 페이지 (예: `https://your-site.com/thank-you`). 없으면 `https://example.com/thank-you` 사용 |

## 배포

```bash
npx supabase functions deploy proposal-viewed
```

## 연동 요약

1. **메일 발송**: `send-proposal-emails` 호출 → 발송대기 브랜드에게 메일 전송, 본문에 `analysis_summary` + 제안서 상세보기 링크 포함
2. **담당자 클릭**: 링크 클릭 → `proposal-viewed` 호출 → DB에서 해당 브랜드 `status` = `확인완료` → 리다이렉트

DB에 `확인완료` 상태가 없으면 마이그레이션 `20250310100000_add_confirm_status.sql` 를 먼저 적용하세요.

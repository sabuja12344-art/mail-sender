# Edge Function: generate-proposals

`status='수집완료'` 인 브랜드를 조회한 뒤, Gemini API로 맞춤 제안(메일 제목·본문)을 생성하고  
`analysis_summary`에 저장하며 `status`를 `제안생성`으로 업데이트합니다.

## 로직

1. `brands` 테이블에서 `status = '수집완료'` 인 행 조회
2. 각 브랜드에 대해:
   - `pixel_installed === false` → 리타겟팅 광고 부재 지적 문구 요청
   - `pixel_installed === true` → 전환 최적화(CRO) 제안 문구 요청
3. Gemini에 프롬프트 전달 후 생성 텍스트를 `analysis_summary`에 저장
4. 해당 행의 `status`를 `제안생성`으로 변경

## 필수 Secret

Supabase 대시보드에서 Edge Function용 Secret 설정:

- **GEMINI_API_KEY**: [Google AI Studio](https://aistudio.google.com/apikey)에서 발급한 API 키

설정 경로: **Project Settings → Edge Functions → Secrets** 에서 `GEMINI_API_KEY` 추가.

## 배포

```bash
cd "c:\Users\PC\Desktop\영업 메일링"
supabase functions deploy generate-proposals
```

## 호출

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/generate-proposals" \
  -H "Authorization: Bearer <ANON_KEY_또는_SERVICE_ROLE_KEY>"
```

또는 Supabase 대시보드 **Edge Functions → generate-proposals → Invoke** 로 테스트.

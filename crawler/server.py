"""
크롤러 원격 실행용 HTTP 서버.
Vercel 등 Python 없는 환경에서는 이 서비스를 별도 배포(Railway/Render 등)하고
Vercel 환경변수 CRAWLER_SERVICE_URL 로 연결하면 '수집 실행'이 동작합니다.
"""
import asyncio
import io
import json
import os
import sys

from flask import Flask, request, jsonify

app = Flask(__name__)

# brand_crawler 모듈의 run_crawler 사용
from brand_crawler import run_crawler


def run_crawler_sync(keyword: str, max_sites: int = 40, max_pages: int = 1, skip_no_email: bool = False):
    """run_crawler는 async이므로 asyncio.run으로 실행."""
    return asyncio.run(run_crawler(keyword=keyword, max_sites=max_sites, max_pages=max_pages, skip_no_email=skip_no_email))


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "service": "crawler"})


@app.route("/run", methods=["POST"])
def run():
    if request.method != "POST":
        return jsonify({"error": "POST only"}), 405

    # 선택: 시크릿 검증 (Vercel에서 CRAWLER_SERVICE_SECRET 설정 시)
    secret = os.environ.get("CRAWLER_SERVICE_SECRET")
    if secret:
        auth = request.headers.get("Authorization") or request.headers.get("X-Crawler-Secret")
        if auth and auth.startswith("Bearer "):
            token = auth[7:].strip()
        else:
            token = request.json.get("secret") if request.is_json else None
        if token != secret:
            return jsonify({"error": "Unauthorized"}), 401

    try:
        data = request.get_json(force=True, silent=True) or {}
        keyword = (data.get("keyword") or "").strip() or "자사몰"
        pages = max(1, min(10, int(data.get("pages") or 1)))
        skip_no_email = bool(data.get("skipNoEmail"))

        # stdout 캡처 (INSERTED_COUNT, 로그 수집)
        old_stdout = sys.stdout
        buf = io.StringIO()
        sys.stdout = buf
        try:
            inserted = run_crawler_sync(keyword=keyword, max_sites=40, max_pages=pages, skip_no_email=skip_no_email)
        finally:
            sys.stdout = old_stdout
        log = buf.getvalue()

        last_line = [line for line in log.split("\n") if line.strip()][-1] if log.strip() else ""
        return jsonify({
            "message": last_line if "insert" in last_line or "완료" in last_line else f"크롤러 완료. (키워드: {keyword}) 새로고침하세요.",
            "insertedCount": inserted,
            "log": log[-8000:] if len(log) > 8000 else log,
        })
    except Exception as e:
        return jsonify({"error": str(e), "detail": repr(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, threaded=True)

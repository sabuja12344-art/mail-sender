"""
로컬 크롤러 서버.
각 사용자 PC에서 실행하면, Vercel 대시보드 브라우저가
http://localhost:5000/run 으로 직접 요청하여 한국 IP로 크롤링합니다.
"""
import asyncio
import io
import os
import sys

from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

from brand_crawler import run_crawler


def run_crawler_sync(keyword: str, max_sites: int = 40, max_pages: int = 1, skip_no_email: bool = False):
    return asyncio.run(run_crawler(keyword=keyword, max_sites=max_sites, max_pages=max_pages, skip_no_email=skip_no_email))


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "service": "crawler"})


@app.route("/run", methods=["POST"])
def run():
    try:
        data = request.get_json(force=True, silent=True) or {}
        keyword = (data.get("keyword") or "").strip() or "자사몰"
        pages = max(1, min(20, int(data.get("pages") or 1)))
        skip_no_email = bool(data.get("skipNoEmail"))

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
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  크롤러 서버 시작: http://localhost:{port}")
    print(f"  Vercel 대시보드에서 '수집 실행'을 누르면 이 PC에서 크롤링됩니다.\n")
    app.run(host="0.0.0.0", port=port, threaded=True)

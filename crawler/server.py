"""
로컬 크롤러 서버 (비동기 실행 버전).
- POST /run  → 즉시 응답, 백그라운드 스레드에서 크롤링
- GET  /status → 현재 실행 상태 반환
- GET  /health  → 서버 생존 확인
"""
import asyncio
import io
import os
import sys
import threading
import time

from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

from brand_crawler import run_crawler

# ------- 전역 상태 -------
_state = {
    "running": False,
    "inserted": 0,
    "message": "",
    "started_at": None,
    "finished_at": None,
    "error": None,
    "log": "",
}
_lock = threading.Lock()


def _run_in_background(keyword, max_sites, page_start, page_end, skip_no_email):
    """백그라운드 스레드에서 크롤러 실행."""
    with _lock:
        _state["running"] = True
        _state["inserted"] = 0
        _state["message"] = ""
        _state["error"] = None
        _state["log"] = ""
        _state["started_at"] = time.time()
        _state["finished_at"] = None

    old_stdout = sys.stdout
    buf = io.StringIO()
    sys.stdout = buf
    try:
        inserted = asyncio.run(
            run_crawler(
                keyword=keyword,
                max_sites=max_sites,
                page_start=page_start,
                page_end=page_end,
                skip_no_email=skip_no_email,
            )
        )
        log = buf.getvalue()
        last_line = next(
            (line for line in reversed(log.split("\n")) if line.strip()), ""
        )
        msg = (
            last_line
            if ("insert" in last_line or "완료" in last_line)
            else f"크롤러 완료. (키워드: {keyword}) 새로고침하세요."
        )
        with _lock:
            _state["inserted"] = inserted
            _state["message"] = msg
            _state["log"] = log[-8000:] if len(log) > 8000 else log
    except Exception as e:
        log = buf.getvalue()
        with _lock:
            _state["error"] = str(e)
            _state["log"] = log[-8000:] if len(log) > 8000 else log
    finally:
        sys.stdout = old_stdout
        with _lock:
            _state["running"] = False
            _state["finished_at"] = time.time()


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "service": "crawler"})


@app.route("/status", methods=["GET"])
def status():
    with _lock:
        snap = dict(_state)
    elapsed = None
    if snap["started_at"]:
        end = snap["finished_at"] or time.time()
        elapsed = int(end - snap["started_at"])
    return jsonify({
        "running": snap["running"],
        "inserted": snap["inserted"],
        "message": snap["message"],
        "error": snap["error"],
        "elapsed": elapsed,
        "log": snap["log"],
    })


@app.route("/run", methods=["POST"])
def run():
    with _lock:
        already_running = _state["running"]

    if already_running:
        return jsonify({"error": "이미 크롤링이 실행 중입니다. 잠시 후 다시 시도하세요."}), 409

    data = request.get_json(force=True, silent=True) or {}
    keyword = (data.get("keyword") or "").strip() or "자사몰"
    page_start = max(1, min(20, int(data.get("pageStart") or 1)))
    page_end = max(1, min(20, int(data.get("pageEnd") or 1)))
    if page_start > page_end:
        page_start, page_end = page_end, page_start
    skip_no_email = bool(data.get("skipNoEmail"))
    num_pages = max(1, page_end - page_start + 1)
    max_sites = max(40, num_pages * 40)

    t = threading.Thread(
        target=_run_in_background,
        args=(keyword, max_sites, page_start, page_end, skip_no_email),
        daemon=True,
    )
    t.start()

    return jsonify({
        "ok": True,
        "message": f"크롤링 시작됨 (키워드: {keyword}, {page_start}~{page_end}페이지). 완료까지 수 분 소요됩니다.",
        "status": "running",
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  크롤러 서버 시작: http://localhost:{port}")
    print(f"  /run 으로 크롤러 시작, /status 로 진행 상황 확인\n")
    app.run(host="0.0.0.0", port=port, threaded=True)

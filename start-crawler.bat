@echo off
chcp 65001 >nul 2>&1
title 크롤러 서버

echo ============================================
echo   영업 메일링 - 로컬 크롤러 서버
echo ============================================
echo.

cd /d "%~dp0"

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Python이 설치되어 있지 않습니다.
    echo        https://www.python.org/downloads/ 에서 설치하세요.
    echo        설치 시 "Add Python to PATH" 체크 필수!
    pause
    exit /b 1
)

if not exist "crawler\.env" (
    if not exist ".env" (
        echo [오류] crawler\.env 또는 .env 파일이 없습니다.
        echo        .env.example 을 복사하여 .env 를 만들고
        echo        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 값을 입력하세요.
        pause
        exit /b 1
    )
)

echo [1/3] Python 패키지 설치 중...
pip install -q -r crawler\requirements.txt
if %errorlevel% neq 0 (
    echo [오류] 패키지 설치 실패
    pause
    exit /b 1
)

echo [2/3] Playwright 브라우저 설치 확인...
python -m playwright install chromium >nul 2>&1

echo [3/3] 크롤러 서버 시작...
echo.
echo   서버 주소: http://localhost:5000
echo   Vercel 대시보드에서 '수집 실행' 버튼을 누르면 됩니다.
echo   종료하려면 이 창을 닫으세요.
echo.

python crawler\server.py

pause

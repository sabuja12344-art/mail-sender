"""
온라인 브랜드 전용 크롤러 (Python + Playwright + Supabase)
- 네이버 파워링크(통합검색 광고) + 쇼핑검색(스마트스토어/브랜드스토어/외부몰) 업체만 수집
- 일반 블로그·위키·뉴스 등 비업체 사이트 제외
- 이메일 추출, 픽셀 설치 여부 확인 후 Supabase brands 테이블에 저장
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
from urllib.parse import urljoin, urlparse

from dotenv import load_dotenv
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
from supabase import create_client, Client

# .env 로드: 루트 .env → web/.env.local (service_role 키는 대시보드와 동일하게)
_root = os.path.join(os.path.dirname(__file__), "..")
load_dotenv(os.path.join(_root, ".env"))
load_dotenv(os.path.join(_root, "web", ".env.local"))

# ---------- 설정 ----------
NAVER_SHOPPING_SEARCH = "https://search.shopping.naver.com/search/all"
NAVER_WEB_SEARCH = "https://search.naver.com/search.naver"
# 네이버 계열 중 수집 제외할 도메인
EXCLUDE_DOMAINS = {
    "naver.com", "naver.co.kr", "nid.naver.com", "map.naver.com",
    "search.naver.com", "shopping.naver.com",
    "cafe.naver.com", "blog.naver.com", "kin.naver.com",
    "place.naver.com", "comic.naver.com",
}
# 수집 허용 네이버 하위 도메인 (스마트스토어, 브랜드스토어)
ALLOWED_NAVER_DOMAINS = {"smartstore.naver.com", "brand.naver.com"}
# 플레이스/지도/오프라인 관련 경로 제외
EXCLUDE_PATH_PATTERNS = re.compile(
    r"map\.naver|place\.naver|local\.naver|/map/|/place/|/local/",
    re.I
)
# 이메일 정규식 (페이지 소스용)
EMAIL_REGEX = re.compile(
    r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
)
# 픽셀 판별 키워드 (HTML 소스에 포함 여부)
PIXEL_KEYWORDS = ("GTM", "FB Pixel", "Kakao Pixel", "gtm.js", "fbevents.js")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
REQUEST_DELAY_SEC = 1.5  # 요청 간 딜레이 (서버 부하·차단 완화)
# 네이버 검색 페이지 JS 렌더링 대기 (해외 서버에서는 더 길게)
NAVER_LOAD_WAIT_SEC = 6


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    # RLS 때문에 insert는 service_role 필요. 없으면 anon 사용(저장 실패할 수 있음)
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL, SUPABASE_ANON_KEY를 .env에 설정하세요. 크롤러 저장 성공하려면 SUPABASE_SERVICE_ROLE_KEY 추가.")
    return create_client(url, key)


def is_excluded_url(href: str) -> bool:
    if not href or not href.strip() or href.startswith("#") or href.startswith("javascript:"):
        return True
    try:
        parsed = urlparse(href)
        domain = (parsed.netloc or "").lower().replace("www.", "")
        for allowed in ALLOWED_NAVER_DOMAINS:
            if allowed in domain or domain.endswith("." + allowed):
                return False
        for ex in EXCLUDE_DOMAINS:
            if ex in domain or domain.endswith("." + ex):
                return True
        if EXCLUDE_PATH_PATTERNS.search(href):
            return True
    except Exception:
        return True
    return False


def normalize_url(href: str, base: str):
    try:
        full = urljoin(base, href)
        parsed = urlparse(full)
        if not parsed.scheme or not parsed.netloc:
            return None
        if parsed.scheme not in ("http", "https"):
            return None
        return full.strip()
    except Exception:
        return None


# 중복 제거·이미 수집/발송 체크용: 동일 업체 = 동일 canonical key
PLACE_MAP_DOMAINS = ("place.naver.com", "map.naver.com", "local.naver.com")


def canonical_url_key(url: str) -> str | None:
    """동일 업체 판별용 키. 쿼리/프래그먼트 제거, 소문자, 트레일링 슬래시 통일."""
    try:
        parsed = urlparse(url)
        netloc = (parsed.netloc or "").lower().replace("www.", "")
        path = (parsed.path or "/").rstrip("/") or "/"
        if not netloc:
            return None
        return f"{parsed.scheme or 'https'}://{netloc}{path}".lower()
    except Exception:
        return None


def is_place_or_map_url(url: str) -> bool:
    """플레이스/지도/로컬 URL이면 True."""
    u = (url or "").lower()
    return any(d in u for d in PLACE_MAP_DOMAINS)


NOISE_EMAIL_PATTERNS = {
    "example.com", "test@", "sentry", "wixpress.com", "github.com",
    "w3.org", "schema.org", "googleapis.com", "gstatic.com",
    "cloudflare.com", "apple.com", "microsoft.com", "google.com",
}

def _is_noise_email(email: str) -> bool:
    lower = email.lower()
    if "@" in lower and lower.split("@")[0].startswith("help"):
        return True
    for noise in NOISE_EMAIL_PATTERNS:
        if noise in lower:
            return True
    if lower.endswith((".png", ".jpg", ".gif", ".svg", ".webp", ".js", ".css")):
        return True
    if "@2x" in lower or "@3x" in lower:
        return True
    return False


def extract_emails_from_html(html: str) -> list[str]:
    """HTML에서 유효한 이메일 주소 모두 추출 (노이즈 제거, 우선순위 정렬)."""
    text = re.sub(r"mailto:\s*", "", html, flags=re.I)
    seen = set()
    results = []
    for m in EMAIL_REGEX.findall(text):
        if _is_noise_email(m):
            continue
        key = m.lower()
        if key not in seen:
            seen.add(key)
            results.append(m)
    return results


def extract_first_email(html: str):
    emails = extract_emails_from_html(html)
    return emails[0] if emails else None


# 이메일이 자주 있는 하위 페이지 경로
CONTACT_SUBPATHS = [
    "/contact", "/contact-us", "/about", "/about-us",
    "/company", "/cs", "/support", "/help",
    "/inquiry", "/info",
    # 한국어 사이트용
    "/company/info", "/cs/center", "/board/contact",
    "/shop/service", "/service",
]


def check_pixel_installed(html: str) -> bool:
    """HTML 소스에 GTM, FB Pixel, Kakao Pixel 관련 키워드 존재 여부."""
    upper = html.upper()
    for kw in PIXEL_KEYWORDS:
        if kw.upper().replace(" ", "") in upper.replace(" ", ""):
            return True
    if "KAKAO" in upper and "PIXEL" in upper:
        return True
    return False


def extract_brand_name_from_page(html: str, page_url: str) -> str:
    """og:title, <title>, 또는 도메인으로 브랜드명 추출."""
    # og:title
    m = re.search(r'<meta[^>]+property=["\']og:site_name["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
    if m:
        return m.group(1).strip()[:200]
    m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:site_name["\']', html, re.I)
    if m:
        return m.group(1).strip()[:200]
    # og:title
    m = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
    if m:
        return m.group(1).strip()[:200]
    m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']', html, re.I)
    if m:
        return m.group(1).strip()[:200]
    # <title>
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I | re.DOTALL)
    if m:
        return m.group(1).strip()[:200]
    # 도메인
    try:
        host = urlparse(page_url).netloc or "Unknown"
        return host.replace("www.", "").split(".")[0] or "Unknown"
    except Exception:
        return "Unknown"


# ---------- 파워링크 추출 JS ----------
# 통합검색 페이지에서 "파워링크" 섹션을 찾아 광고주 랜딩 URL 수집
_POWERLINK_JS = """
() => {
  const urls = [];
  const skip = (h) =>
    h.includes('search.naver.com/search') ||
    h.includes('help.naver.com') ||
    h.includes('nid.naver.com') ||
    h.includes('policy.naver.com') ||
    h.includes('terms.naver.com') ||
    h.includes('news.naver.com') ||
    h.includes('place.naver.com') ||
    h.includes('map.naver.com') ||
    h.includes('local.naver.com') ||
    h.includes('#');

  // 1) "파워링크" 텍스트를 포함한 라벨을 찾아 상위 컨테이너에서 링크 추출 (페이지 내 모든 파워링크 블록 수집)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode.textContent.trim();
    if (t === '파워링크' || t === 'PowerLink') {
      let container = walker.currentNode.parentElement;
      for (let lv = 0; lv < 12 && container; lv++) {
        const anchors = container.querySelectorAll('a[href]');
        const found = [];
        anchors.forEach(a => {
          const h = a.href;
          if (h && h.startsWith('http') && !skip(h)) found.push(h);
        });
        if (found.length >= 2) { found.forEach(u => urls.push(u)); break; }
        container = container.parentElement;
      }
    }
  }

  // 2) 폴백: id/class에 'power', 'ad_' 등이 포함된 섹션의 링크
  if (urls.length === 0) {
    document.querySelectorAll('[id*="power" i], [class*="power" i], [id*="sp_n" i], [class*="sp_n" i]').forEach(sec => {
      sec.querySelectorAll('a[href]').forEach(a => {
        const h = a.href;
        if (h && h.startsWith('http') && !skip(h)) urls.push(h);
      });
    });
  }

  return [...new Set(urls)];
}
"""

# ---------- 쇼핑검색 스토어 링크 추출 JS ----------
# 쇼핑 검색 결과에서 스마트스토어/브랜드스토어/외부몰 링크만 수집 (내부 네비게이션 제외)
_SHOPPING_STORE_LINKS_JS = """
() => {
  const urls = [];
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href;
    if (!href || !href.startsWith('http')) return;

    // 네이버 쇼핑 내부 네비게이션/검색 URL은 스킵
    if (href.includes('search.shopping.naver.com') ||
        href.includes('search.naver.com') ||
        href.includes('nid.naver.com') ||
        href.includes('help.naver.com') ||
        href.includes('terms.naver.com') ||
        href.includes('policy.naver.com') ||
        href.includes('news.naver.com') ||
        href.includes('cafe.naver.com') ||
        href.includes('blog.naver.com') ||
        href.includes('map.naver.com') ||
        href.includes('place.naver.com') ||
        href.includes('kin.naver.com') ||
        href.includes('comic.naver.com') ||
        href.includes('#')) return;

    // 허용: 스마트스토어, 브랜드스토어, 광고 리디렉트, 외부몰
    const isStore =
      href.includes('smartstore.naver.com') ||
      href.includes('brand.naver.com') ||
      href.includes('shopping.naver.com/window') ||
      href.includes('cr.shopping.naver.com') ||
      (!href.includes('naver.com') && !href.includes('naver.co.kr'));

    if (isStore) urls.push(href);
  });
  return [...new Set(urls)];
}
"""


async def collect_powerlink_urls(page, keyword: str, max_results: int = 20, page_start: int = 1, page_end: int = 1) -> set:
    """네이버 통합검색에서 파워링크(광고) 업체 URL 수집. 페이지는 하단 페이지 번호(1,2,3...), start=(페이지-1)*10+1."""
    urls = set()
    page_start = max(1, page_start)
    page_end = max(page_start, page_end)
    for pg in range(page_start, page_end + 1):
        start_val = (pg - 1) * 10 + 1
        url = f"{NAVER_WEB_SEARCH}?query={keyword}&start={start_val}"
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(NAVER_LOAD_WAIT_SEC)
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            raw = await page.evaluate(_POWERLINK_JS)
            before = len(urls)
            for href in raw:
                u = normalize_url(href, url)
                if u and not is_place_or_map_url(u):
                    urls.add(u)
                if len(urls) >= max_results:
                    break
            added = len(urls) - before
            print(f"      [파워링크 {pg}페이지] {added}개 신규 URL (누적 {len(urls)}개)")
            if len(urls) >= max_results:
                break
        except PlaywrightTimeout:
            print(f"      [파워링크 {pg}페이지] 타임아웃")
            break
        except Exception as e:
            print(f"      [파워링크 {pg}페이지 오류] {e}")
            break
    return urls


async def collect_shopping_store_urls(page, keyword: str, max_results: int = 20, page_start: int = 1, page_end: int = 1) -> set:
    """네이버 쇼핑검색에서 스토어 URL을 지정 페이지 범위(맨 하단 페이지 번호)로 수집."""
    urls = set()
    page_start = max(1, page_start)
    page_end = max(page_start, page_end)
    for pg in range(page_start, page_end + 1):
        page_url = f"{NAVER_SHOPPING_SEARCH}?query={keyword}&pagingIndex={pg}"
        try:
            await page.goto(page_url, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(NAVER_LOAD_WAIT_SEC)
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            raw = await page.evaluate(_SHOPPING_STORE_LINKS_JS)
            before = len(urls)
            for href in raw:
                u = normalize_url(href, page_url)
                if u and not is_place_or_map_url(u):
                    urls.add(u)
            added = len(urls) - before
            print(f"      [쇼핑 {pg}페이지] {added}개 신규 URL (누적 {len(urls)}개)")
            if added == 0:
                break
            if len(urls) >= max_results:
                break
        except PlaywrightTimeout:
            print(f"      [쇼핑 {pg}페이지] 타임아웃")
            break
        except Exception as e:
            print(f"      [쇼핑 {pg}페이지 오류] {e}")
            break
    return urls


async def fetch_page_content(page, url: str):
    """URL 방문 후 HTML과 최종 URL 반환."""
    try:
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=12000)
        if resp and resp.status >= 400:
            return "", url
        await asyncio.sleep(0.8)
        html = await page.content()
        final_url = page.url
        return html, final_url
    except Exception:
        return "", url


# 이메일 탐색용 JS: 페이지에서 회사소개/고객센터/문의 링크를 찾아 href 반환
_FIND_CONTACT_LINKS_JS = """
() => {
  const keywords = [
    '문의', '고객센터', 'contact', 'about', '회사소개', '상담',
    'cs', 'support', '이메일', 'email', '연락', '고객지원',
    '회사정보', '사업자정보', 'company', 'info', '입점문의',
  ];
  const urls = [];
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href;
    const text = (a.textContent || '').trim().toLowerCase();
    const hrefLower = href.toLowerCase();
    if (!href.startsWith('http')) return;
    const match = keywords.some(kw =>
      text.includes(kw) || hrefLower.includes(kw)
    );
    if (match) urls.push(href);
  });
  return [...new Set(urls)].slice(0, 5);
}
"""


async def _deep_search_email(page, base_url: str) -> str | None:
    """메인 페이지에서 이메일을 못 찾았을 때, 하위 페이지를 탐색해 이메일을 찾는다."""
    parsed = urlparse(base_url)
    base_origin = f"{parsed.scheme}://{parsed.netloc}"

    # 전략 1: 페이지 내 '문의/고객센터/contact' 링크를 JS로 찾아 방문
    try:
        contact_links = await page.evaluate(_FIND_CONTACT_LINKS_JS)
    except Exception:
        contact_links = []

    # 전략 2: 일반적인 하위 경로 추가
    subpath_urls = [base_origin + sp for sp in CONTACT_SUBPATHS]
    candidates = list(dict.fromkeys(contact_links + subpath_urls))

    for sub_url in candidates[:8]:
        try:
            resp = await page.goto(sub_url, wait_until="domcontentloaded", timeout=8000)
            if resp and resp.status >= 400:
                continue
            await asyncio.sleep(0.5)
            sub_html = await page.content()
            email = extract_first_email(sub_html)
            if email:
                return email
        except Exception:
            continue
    return None


async def run_crawler(keyword: str, max_sites: int = 40, page_start: int = 1, page_end: int = 1, skip_no_email: bool = False):
    if not keyword:
        keyword = "자사몰"
    keyword = keyword.strip()
    supabase = get_supabase()

    # 기존 DB 업체·이미 발송한 업체 canonical set (중복·재발송 방지)
    existing_canonical: set[str] = set()
    already_sent_canonical: set[str] = set()
    try:
        res = supabase.table("brands").select("website_url, status").execute()
        for row in (res.data or []):
            w = (row.get("website_url") or "").strip()
            if not w:
                continue
            key = canonical_url_key(w)
            if key:
                existing_canonical.add(key)
                if (row.get("status") or "") in ("발송완료", "확인완료"):
                    already_sent_canonical.add(key)
        print(f"      [DB] 기존 {len(existing_canonical)}건, 이미 발송 {len(already_sent_canonical)}건")
    except Exception as e:
        print(f"      [DB 조회 경고] {e}")

    num_pages = max(1, page_end - page_start + 1)
    # 페이지 수에 비례해 URL 수집·방문 상한 확대 (20페이지면 소스당 600개·최대 800개 방문)
    max_results_per_source = max(max_sites, num_pages * 50)
    visit_limit = max(max_sites, num_pages * 40)

    all_urls = set()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=USER_AGENT,
            locale="ko-KR",
            timezone_id="Asia/Seoul",
            viewport={"width": 1280, "height": 720},
        )
        page = await context.new_page()

        try:
            print(f"[1/3] 네이버 업체 수집: '{keyword}' (파워링크 + 쇼핑 {page_start}~{page_end}페이지, 소스당 최대 {max_results_per_source}개)")
            pl_urls = await collect_powerlink_urls(page, keyword, max_results=max_results_per_source, page_start=page_start, page_end=page_end)
            shop_urls = await collect_shopping_store_urls(page, keyword, max_results=max_results_per_source, page_start=page_start, page_end=page_end)
            raw_merged = pl_urls | shop_urls
            # canonical 기준 중복 제거 (동일 업체 한 번만)
            seen_key: set[str] = set()
            for u in raw_merged:
                k = canonical_url_key(u)
                if k and k not in seen_key:
                    seen_key.add(k)
                    all_urls.add(u)
            print(f"      → 파워링크 {len(pl_urls)}개 + 쇼핑 {len(shop_urls)}개 → 중복 제거 후 {len(all_urls)}개 (최대 {visit_limit}개 방문)")
        finally:
            await browser.close()

    # 3) 각 URL 방문 — 이메일·픽셀·브랜드명 추출
    inserted = 0
    skipped_dup = 0
    skipped_sent = 0
    skipped_no_email = 0
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(user_agent=USER_AGENT)
        page = await context.new_page()

        visited_canonical: set[str] = set()
        skipped_excluded = 0

        for i, url in enumerate(list(all_urls)[:visit_limit]):
            count_label = f"({i+1}/{min(len(all_urls), visit_limit)})"
            print(f"[2/3] 방문 {count_label}: {url[:80]}...")
            html, final_url = await fetch_page_content(page, url)
            if not html:
                continue

            # 최종 랜딩 URL 기준으로 제외 판별 (플레이스/블로그/카페/지도 등)
            if is_excluded_url(final_url) or is_place_or_map_url(final_url):
                print(f"      → 제외 (비업체 페이지): {final_url[:70]}")
                skipped_excluded += 1
                continue

            # 최종 랜딩 URL 기준으로 중복 체크 (같은 광고주의 여러 소재 대응)
            canon = canonical_url_key(final_url)
            if not canon:
                continue
            if canon in existing_canonical:
                if canon in already_sent_canonical:
                    skipped_sent += 1
                    print(f"      → 스킵 (이미 발송): {final_url[:70]}")
                else:
                    skipped_dup += 1
                    print(f"      → 스킵 (DB 중복): {final_url[:70]}")
                continue
            if canon in visited_canonical:
                skipped_dup += 1
                print(f"      → 스킵 (이번 실행 중복): {final_url[:70]}")
                continue
            visited_canonical.add(canon)

            email = extract_first_email(html)
            pixel_installed = check_pixel_installed(html)
            name = extract_brand_name_from_page(html, final_url)

            # 이메일을 못 찾으면 하위 페이지(회사소개/고객센터/문의 등) 탐색
            if not email:
                print(f"      → 이메일 없음, 하위 페이지 탐색 중...")
                email = await _deep_search_email(page, final_url)
                if email:
                    print(f"      → 하위 페이지에서 발견: {email}")

            if skip_no_email and not email:
                skipped_no_email += 1
                print(f"      → 스킵 (이메일 없음, 수집 안 함 옵션)")
                continue

            row = {
                "name": name or urlparse(final_url).netloc or "Unknown",
                "website_url": final_url,
                "email": email,
                "pixel_installed": pixel_installed,
                "analysis_summary": None,
                "status": "수집완료",
                "search_keyword": keyword,
            }
            try:
                supabase.table("brands").insert(row).execute()
                inserted += 1
                existing_canonical.add(canon)
                print(f"      → DB 저장: {(name or '')[:40]} | 픽셀: {pixel_installed} | 이메일: {email or '-'}")
            except Exception as e:
                print(f"      → 저장 실패: {e}")
            await asyncio.sleep(REQUEST_DELAY_SEC)

        await browser.close()

    print(f"[3/3] 완료. 신규 {inserted}건 저장, 중복 스킵 {skipped_dup}건, 이미 발송 스킵 {skipped_sent}건, 비업체 제외 {skipped_excluded}건" + (f", 이메일 없음 스킵 {skipped_no_email}건." if skip_no_email else "."))
    print(f"INSERTED_COUNT={inserted}")
    return inserted


def main():
    import argparse
    parser = argparse.ArgumentParser(description="네이버 브랜드 크롤러")
    parser.add_argument("keyword", nargs="?", default="자사몰", help="검색 키워드")
    parser.add_argument("--page-start", type=int, default=1, help="쇼핑검색 시작 페이지 (기본 1)")
    parser.add_argument("--page-end", type=int, default=1, help="쇼핑검색 끝 페이지 (기본 1)")
    parser.add_argument("--max", type=int, default=40, help="최대 수집 건수 (기본 40)")
    parser.add_argument("--skip-no-email", action="store_true", help="이메일이 없는 업체는 DB에 저장하지 않음")
    args = parser.parse_args()
    asyncio.run(run_crawler(keyword=args.keyword, max_sites=args.max, page_start=args.page_start, page_end=args.page_end, skip_no_email=args.skip_no_email))


if __name__ == "__main__":
    main()

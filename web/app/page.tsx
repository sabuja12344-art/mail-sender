"use client";

import { useEffect, useState, useCallback } from "react";

type Brand = {
  id: string;
  name: string;
  website_url: string | null;
  email: string | null;
  pixel_installed: boolean;
  status: string;
  created_at: string;
  search_keyword?: string | null;
};

type InlineImageItem = { content_id: string; url: string; width?: number; height?: number };

type EmailConfig = {
  id: string;
  template_subject: string;
  template_html: string;
  from_email: string;
  inline_images?: InlineImageItem[];
};

export default function DashboardPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"idle" | "send" | "crawler">("idle");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [crawlerKeyword, setCrawlerKeyword] = useState("");
  const [crawlerPages, setCrawlerPages] = useState(1);

  // 이메일 설정
  const [emailConfig, setEmailConfig] = useState<EmailConfig | null>(null);
  const [showTemplate, setShowTemplate] = useState(false);
  const [tplSubject, setTplSubject] = useState("");
  const [tplHtml, setTplHtml] = useState("");
  const [tplFrom, setTplFrom] = useState("");
  const [tplSaving, setTplSaving] = useState(false);
  const [inlineImages, setInlineImages] = useState<InlineImageItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [newCid, setNewCid] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // 선택 관리
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchBrands = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/brands");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "조회 실패");
      setBrands(Array.isArray(data) ? data : []);
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
      setBrands([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEmailConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/email-config");
      if (!res.ok) return;
      const data = await res.json();
      setEmailConfig(data);
      setTplSubject(data.template_subject || "");
      setTplHtml(data.template_html || "");
      setTplFrom(data.from_email || "");
      setInlineImages(Array.isArray(data.inline_images) ? data.inline_images : []);
    } catch {
      /* 무시 */
    }
  }, []);

  useEffect(() => {
    fetchBrands();
    fetchEmailConfig();
  }, [fetchBrands, fetchEmailConfig]);

  const runSendEmails = async () => {
    setAction("send");
    setMessage(null);
    try {
      const res = await fetch("/api/trigger-send-emails", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "실행 실패");
      setMessage({ type: "ok", text: `메일 발송 완료: ${data.sent ?? 0}건` });
      fetchBrands();
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
    } finally {
      setAction("idle");
    }
  };

  const runCrawler = async () => {
    setAction("crawler");
    setMessage(null);
    try {
      const res = await fetch("/api/run-crawler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: crawlerKeyword, pages: crawlerPages }),
      });
      const text = await res.text();
      let data: { error?: string; detail?: string; message?: string; insertedCount?: number } = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: "응답 파싱 실패", detail: text.slice(0, 500) }; }
      if (!res.ok) {
        const errMsg = data.detail ? `${data.error || "실행 실패"}\n${data.detail}` : (data.error || "실행 실패");
        throw new Error(errMsg);
      }
      const successText =
        typeof data.insertedCount === "number"
          ? `${data.insertedCount}개가 정상 수집되었습니다.`
          : (data.message ?? "크롤러 완료.");
      setMessage({ type: "ok", text: successText });
      fetchBrands();
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
    } finally {
      setAction("idle");
    }
  };

  // 선택한 브랜드를 발송대기로 변경
  const setSelectedToReady = async () => {
    if (selected.size === 0) return;
    let ok = 0;
    for (const id of Array.from(selected)) {
      try {
        const res = await fetch("/api/brands", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status: "발송대기" }),
        });
        if (res.ok) ok++;
      } catch { /* skip */ }
    }
    setMessage({ type: "ok", text: `${ok}건 → 발송대기로 변경` });
    setSelected(new Set());
    fetchBrands();
  };

  // 템플릿 저장
  const saveTemplate = async () => {
    if (!emailConfig) return;
    setTplSaving(true);
    try {
      const res = await fetch("/api/email-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: emailConfig.id,
          template_subject: tplSubject,
          template_html: tplHtml,
          from_email: tplFrom,
          inline_images: inlineImages,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "저장 실패");
      setMessage({ type: "ok", text: "이메일 설정이 저장되었습니다." });
      fetchEmailConfig();
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
    } finally {
      setTplSaving(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const eligible = brands.filter((b) => b.status === "수집완료" && b.email);
    if (selected.size === eligible.length && eligible.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligible.map((b) => b.id)));
    }
  };

  const statusCounts = brands.reduce(
    (acc, b) => { acc[b.status] = (acc[b.status] || 0) + 1; return acc; },
    {} as Record<string, number>
  );

  const statusColor = (s: string) => {
    switch (s) {
      case "수집완료": return { bg: "#f1f5f9", text: "#475569" };
      case "발송대기": return { bg: "#fef3c7", text: "#92400e" };
      case "발송완료": return { bg: "#dcfce7", text: "#166534" };
      case "확인완료": return { bg: "#e0e7ff", text: "#3730a3" };
      default: return { bg: "#f1f5f9", text: "#475569" };
    }
  };

  const eligibleCount = brands.filter((b) => b.status === "수집완료" && b.email).length;

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginBottom: 8, fontSize: "1.5rem" }}>영업 메일링 대시보드</h1>
      <p style={{ color: "#64748b", marginBottom: 24 }}>
        브랜드 수집 → 발송 대상 선택 → 이메일 템플릿 작성 → 메일 발송
      </p>

      {/* 크롤러 */}
      <section style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <label htmlFor="crawler-keyword" style={{ fontWeight: 600 }}>키워드 수집</label>
          <input
            id="crawler-keyword"
            type="text"
            placeholder="비우면 자사몰로 검색"
            value={crawlerKeyword}
            onChange={(e) => setCrawlerKeyword(e.target.value)}
            style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, minWidth: 180 }}
          />
          <label htmlFor="crawler-pages" style={{ fontWeight: 600, marginLeft: 8 }}>페이지</label>
          <input
            id="crawler-pages"
            type="number"
            min={1}
            max={10}
            value={crawlerPages}
            onChange={(e) => setCrawlerPages(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, width: 60, textAlign: "center" }}
          />
          <button
            onClick={runCrawler}
            disabled={action !== "idle"}
            style={{
              padding: "10px 20px",
              background: action === "crawler" ? "#94a3b8" : "#7c3aed",
              color: "#fff", border: "none", borderRadius: 8,
              cursor: action === "idle" ? "pointer" : "not-allowed", fontWeight: 600,
            }}
          >
            {action === "crawler" ? "실행 중…" : `수집 실행 (${crawlerPages}페이지)`}
          </button>
        </div>
      </section>

      {/* 액션 버튼 */}
      <section style={{ marginBottom: 24, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={setSelectedToReady}
          disabled={selected.size === 0}
          style={{
            padding: "10px 20px",
            background: selected.size > 0 ? "#f59e0b" : "#d1d5db",
            color: "#fff", border: "none", borderRadius: 8,
            cursor: selected.size > 0 ? "pointer" : "not-allowed", fontWeight: 600,
          }}
        >
          선택 → 발송대기 ({selected.size}건)
        </button>
        <button
          onClick={runSendEmails}
          disabled={action !== "idle"}
          title="발송대기 상태 브랜드에게 메일 발송"
          style={{
            padding: "10px 20px",
            background: action === "send" ? "#94a3b8" : "#059669",
            color: "#fff", border: "none", borderRadius: 8,
            cursor: action === "idle" ? "pointer" : "not-allowed", fontWeight: 600,
          }}
        >
          {action === "send" ? "발송 중…" : "메일 발송"}
        </button>
        <button
          onClick={() => setShowTemplate(!showTemplate)}
          style={{
            padding: "10px 20px",
            background: showTemplate ? "#6366f1" : "#8b5cf6",
            color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600,
          }}
        >
          {showTemplate ? "템플릿 닫기" : "이메일 템플릿 설정"}
        </button>
        <button
          onClick={fetchBrands}
          disabled={loading}
          style={{
            padding: "10px 20px", background: "#64748b", color: "#fff",
            border: "none", borderRadius: 8, cursor: "pointer",
          }}
        >
          새로고침
        </button>
      </section>

      {/* 메시지 */}
      {message && (
        <p style={{
          padding: 12, borderRadius: 8,
          background: message.type === "ok" ? "#dcfce7" : "#fee2e2",
          color: message.type === "ok" ? "#166534" : "#991b1b",
          marginBottom: 24, whiteSpace: "pre-wrap",
        }}>
          {message.text}
        </p>
      )}

      {/* 이메일 템플릿 에디터 */}
      {showTemplate && (
        <section style={{
          marginBottom: 24, padding: 24,
          background: "#faf5ff", borderRadius: 12,
          border: "1px solid #e9d5ff",
        }}>
          <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: "1.1rem" }}>이메일 템플릿 설정</h3>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>발신 이메일 주소</label>
            <input
              type="email"
              value={tplFrom}
              onChange={(e) => setTplFrom(e.target.value)}
              placeholder="onboarding@resend.dev"
              style={{ padding: "8px 12px", border: "1px solid #d4d4d8", borderRadius: 8, width: "100%", maxWidth: 400 }}
            />
            <p style={{ fontSize: 12, color: "#71717a", marginTop: 4 }}>
              Resend 무료 플랜은 onboarding@resend.dev만 가능. 자체 도메인은 Resend에서 도메인 인증 필요.
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>메일 제목</label>
            <input
              type="text"
              value={tplSubject}
              onChange={(e) => setTplSubject(e.target.value)}
              style={{ padding: "8px 12px", border: "1px solid #d4d4d8", borderRadius: 8, width: "100%" }}
            />
            <p style={{ fontSize: 12, color: "#71717a", marginTop: 4 }}>
              {`{{업체명}}을 넣으면 브랜드명으로 자동 치환됩니다.`}
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>
              메일 본문 (HTML)
            </label>
            <textarea
              value={tplHtml}
              onChange={(e) => setTplHtml(e.target.value)}
              rows={15}
              style={{
                padding: 16, border: "1px solid #d4d4d8", borderRadius: 8,
                width: "100%", fontFamily: "monospace", fontSize: 13, lineHeight: 1.6,
                resize: "vertical",
              }}
            />
            <p style={{ fontSize: 12, color: "#71717a", marginTop: 4 }}>
              {`변수: {{업체명}}, {{웹사이트}}. 인라인 이미지는 아래에서 업로드 후 본문에 <img src="cid:이미지ID"> 로 넣으세요.`}
            </p>
          </div>

          {/* 인라인 이미지 업로드 */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 8 }}>인라인 이미지 (본문에 넣을 이미지)</label>
            <p style={{ fontSize: 12, color: "#71717a", marginBottom: 8 }}>
              이미지를 업로드하면 메일 본문에 첨부되어 표시됩니다. 본문 HTML에 <code style={{ background: "#e4e4e7", padding: "2px 6px", borderRadius: 4 }}>{`<img src="cid:이미지ID">`}</code> 로 사용하세요.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setUploadFile(f);
                }}
                style={{ fontSize: 13 }}
              />
              <input
                type="text"
                placeholder="이미지 ID (예: logo)"
                value={newCid}
                onChange={(e) => setNewCid(e.target.value)}
                style={{ padding: "6px 10px", border: "1px solid #d4d4d8", borderRadius: 8, width: 140 }}
              />
              <button
                type="button"
                disabled={!uploadFile || uploading}
                onClick={async () => {
                  if (!uploadFile) return;
                  setUploading(true);
                  try {
                    const fd = new FormData();
                    fd.append("file", uploadFile);
                    fd.append("content_id", newCid.trim() || "img");
                    const res = await fetch("/api/email-config/upload", { method: "POST", body: fd });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "업로드 실패");
                    setInlineImages((prev) => [...prev, { content_id: data.content_id, url: data.url }]);
                    setUploadFile(null);
                    setNewCid("");
                    if (document.querySelector('input[type="file"]') instanceof HTMLInputElement) {
                      (document.querySelector('input[type="file"]') as HTMLInputElement).value = "";
                    }
                  } catch (e) {
                    setMessage({ type: "err", text: (e as Error).message });
                  } finally {
                    setUploading(false);
                  }
                }}
                style={{
                  padding: "8px 16px",
                  background: uploading ? "#d1d5db" : "#7c3aed",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: uploading ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {uploading ? "업로드 중…" : "업로드 후 추가"}
              </button>
            </div>
            {inlineImages.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {inlineImages.map((img, idx) => (
                  <li
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 12px",
                      background: "#f4f4f5",
                      borderRadius: 8,
                      marginBottom: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <img src={img.url} alt={img.content_id} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4 }} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>cid:{img.content_id}</span>
                    <code style={{ fontSize: 11, color: "#71717a" }}>{`<img src="cid:${img.content_id}">`}</code>
                    <span style={{ fontSize: 12, color: "#71717a" }}>가로</span>
                    <input
                      type="number"
                      min={1}
                      max={800}
                      placeholder="px"
                      value={img.width ?? ""}
                      onChange={(e) => {
                        const v = e.target.value ? parseInt(e.target.value, 10) : undefined;
                        setInlineImages((prev) => prev.map((x, i) => (i === idx ? { ...x, width: v && v > 0 ? v : undefined } : x)));
                      }}
                      style={{ width: 56, padding: "4px 6px", border: "1px solid #d4d4d8", borderRadius: 6, fontSize: 12 }}
                    />
                    <span style={{ fontSize: 12, color: "#71717a" }}>세로</span>
                    <input
                      type="number"
                      min={1}
                      max={800}
                      placeholder="px"
                      value={img.height ?? ""}
                      onChange={(e) => {
                        const v = e.target.value ? parseInt(e.target.value, 10) : undefined;
                        setInlineImages((prev) => prev.map((x, i) => (i === idx ? { ...x, height: v && v > 0 ? v : undefined } : x)));
                      }}
                      style={{ width: 56, padding: "4px 6px", border: "1px solid #d4d4d8", borderRadius: 6, fontSize: 12 }}
                    />
                    <button
                      type="button"
                      onClick={() => setInlineImages((prev) => prev.filter((_, i) => i !== idx))}
                      style={{
                        marginLeft: "auto",
                        padding: "4px 10px",
                        background: "#fecaca",
                        color: "#991b1b",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 미리보기 */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>미리보기</label>
            <div
              style={{
                border: "1px solid #d4d4d8", borderRadius: 8, padding: 16,
                background: "#fff", maxHeight: 300, overflow: "auto",
              }}
              dangerouslySetInnerHTML={{
                __html: (() => {
                  let html = tplHtml
                    .replace(/\{\{업체명\}\}/g, "샘플업체")
                    .replace(/\{\{brand_name\}\}/g, "샘플업체")
                    .replace(/\{\{웹사이트\}\}/g, "https://example.com")
                    .replace(/\{\{website_url\}\}/g, "https://example.com");
                  const placeholder = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
                  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  inlineImages.forEach((img) => {
                    const cid = esc(img.content_id);
                    const url = img.url.replace(/"/g, "&quot;");
                    const dims = [];
                    if (img.width && img.width > 0) dims.push(`width="${img.width}"`);
                    if (img.height && img.height > 0) dims.push(`height="${img.height}"`);
                    const dimStr = dims.length ? ` ${dims.join(" ")}` : "";
                    const re = new RegExp(`<img([^>]*)src=["']cid:${cid}["']([^>]*)>`, "gi");
                    html = html.replace(re, (_, before, after) => `<img${before}src="${url}"${dimStr}${after}>`);
                  });
                  const resolveCid = (id: string) => {
                    const cid = (id || "").trim();
                    const img = inlineImages.find((i) => i.content_id.toLowerCase() === cid.toLowerCase());
                    return img ? img.url.replace(/"/g, "&quot;") : placeholder;
                  };
                  html = html.replace(/src=["']cid:([^"']+)["']/gi, (_, id) => `src="${resolveCid(id)}"`);
                  html = html.replace(/src=cid:([^\s>]+)/gi, (_, id) => `src="${resolveCid(id)}"`);
                  return html;
                })(),
              }}
            />
          </div>

          <button
            onClick={saveTemplate}
            disabled={tplSaving}
            style={{
              padding: "10px 24px",
              background: tplSaving ? "#94a3b8" : "#7c3aed",
              color: "#fff", border: "none", borderRadius: 8,
              cursor: tplSaving ? "not-allowed" : "pointer", fontWeight: 600,
            }}
          >
            {tplSaving ? "저장 중…" : "설정 저장"}
          </button>
        </section>
      )}

      {/* 상태 카운트 */}
      {Object.keys(statusCounts).length > 0 && (
        <div style={{ marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
          {Object.entries(statusCounts).map(([status, count]) => {
            const c = statusColor(status);
            return (
              <span key={status} style={{ background: c.bg, color: c.text, padding: "4px 12px", borderRadius: 6, fontSize: 13 }}>
                {status}: {count}
              </span>
            );
          })}
        </div>
      )}

      {/* 브랜드 테이블 */}
      {loading ? (
        <p>목록 조회 중…</p>
      ) : brands.length === 0 ? (
        <p style={{ color: "#64748b" }}>
          브랜드가 없습니다. 위에서 키워드를 입력하고 「수집 실행」 후 1~2분 뒤 새로고침하세요.
        </p>
      ) : (
        <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                <th style={{ padding: "12px 8px", borderBottom: "1px solid #e2e8f0", textAlign: "center", width: 40 }}>
                  <input
                    type="checkbox"
                    checked={eligibleCount > 0 && selected.size === eligibleCount}
                    onChange={toggleSelectAll}
                    title="이메일 있는 수집완료 전체 선택"
                  />
                </th>
                <th style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>키워드</th>
                <th style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>브랜드</th>
                <th style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>이메일</th>
                <th style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>픽셀</th>
                <th style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>상태</th>
                <th style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>수집일</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => {
                const sc = statusColor(b.status);
                const canSelect = b.status === "수집완료" && !!b.email;
                return (
                  <tr key={b.id} style={{ borderBottom: "1px solid #f1f5f9", background: selected.has(b.id) ? "#fefce8" : undefined }}>
                    <td style={{ padding: "12px 8px", textAlign: "center" }}>
                      {canSelect ? (
                        <input
                          type="checkbox"
                          checked={selected.has(b.id)}
                          onChange={() => toggleSelect(b.id)}
                        />
                      ) : (
                        <span style={{ color: "#d1d5db" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#7c3aed", fontSize: 12, fontWeight: 600 }}>
                      {b.search_keyword || "—"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <a
                        href={b.website_url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#2563eb", textDecoration: "none" }}
                      >
                        {b.name}
                      </a>
                    </td>
                    <td style={{ padding: "12px 16px", color: b.email ? "#059669" : "#d1d5db", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {b.email || "없음"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>{b.pixel_installed ? "O" : "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 6, background: sc.bg, color: sc.text, fontSize: 12 }}>
                        {b.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#64748b" }}>
                      {b.created_at ? new Date(b.created_at).toLocaleDateString("ko-KR") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <footer style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #e2e8f0", fontSize: 12, color: "#64748b" }}>
        흐름: 수집 실행 → 발송 대상 체크 → 「선택 → 발송대기」 → 이메일 템플릿 설정 → 「메일 발송」
      </footer>
    </main>
  );
}

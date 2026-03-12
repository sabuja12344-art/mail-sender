"use client";

import { useEffect, useState, useCallback, useRef } from "react";

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

type EmailTemplate = EmailConfig & {
  name: string;
  is_default?: boolean;
  created_at?: string;
};

export default function DashboardPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"idle" | "send" | "crawler">("idle");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [crawlerKeyword, setCrawlerKeyword] = useState("");
  const [crawlerPages, setCrawlerPages] = useState(1);
  const [crawlerSkipNoEmail, setCrawlerSkipNoEmail] = useState(false);
  const [crawlerUrl, setCrawlerUrl] = useState("http://localhost:5000");
  const [showCrawlerSettings, setShowCrawlerSettings] = useState(false);
  const [crawlerServerOnline, setCrawlerServerOnline] = useState<boolean | null>(null);
  const [crawlerElapsed, setCrawlerElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("crawlerUrl");
    if (saved) setCrawlerUrl(saved);
  }, []);

  const saveCrawlerUrl = (url: string) => {
    setCrawlerUrl(url);
    localStorage.setItem("crawlerUrl", url);
  };

  const checkCrawlerHealth = useCallback(async () => {
    try {
      const res = await fetch(`${crawlerUrl.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(3000) });
      const d = await res.json();
      setCrawlerServerOnline(!!d.ok);
    } catch {
      setCrawlerServerOnline(false);
    }
  }, [crawlerUrl]);

  useEffect(() => {
    checkCrawlerHealth();
    const id = setInterval(checkCrawlerHealth, 15000);
    return () => clearInterval(id);
  }, [checkCrawlerHealth]);

  // 이메일 템플릿 (여러 개)
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | "">("");
  const [showTemplate, setShowTemplate] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | "new" | null>(null);
  const [tplName, setTplName] = useState("");
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
  // 테이블 필터: 전체 | 발송완료만
  const [statusFilter, setStatusFilter] = useState<"전체" | "발송완료">("전체");

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

  const fetchEmailTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/email-templates");
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setTemplates(list);
      const defaultTpl = list.find((t: EmailTemplate) => t.is_default) || list[0];
      setSelectedTemplateId(defaultTpl?.id ?? "");
    } catch {
      /* 무시 */
    }
  }, []);

  useEffect(() => {
    fetchBrands();
    fetchEmailTemplates();
  }, [fetchBrands, fetchEmailTemplates]);

  const runSendEmails = async () => {
    setAction("send");
    setMessage(null);
    try {
      const sendBody: { brandIds?: string[]; templateId?: string; fromEmail?: string } = selected.size > 0
        ? { brandIds: Array.from(selected) }
        : {};
      if (selectedTemplateId) sendBody.templateId = selectedTemplateId;
      const selectedTpl = templates.find((t) => t.id === selectedTemplateId);
      if (selectedTpl?.from_email?.trim()) sendBody.fromEmail = selectedTpl.from_email.trim();
      const res = await fetch("/api/trigger-send-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendBody),
      });
      const data = await res.json() as { sent?: number; errors?: string[]; message?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "실행 실패");
      const sent = data.sent ?? 0;
      const errList = Array.isArray(data.errors) ? data.errors as string[] : [];
      const usedFrom = (data as { used_from?: string }).used_from;
      const templateFrom = (data as { template_from_email?: string | null }).template_from_email;
      let msg = sent > 0
        ? `메일 발송 완료: ${sent}건${usedFrom ? ` (발신: ${usedFrom})` : ""}`
        : (data.message || "발송된 메일이 없습니다.");
      if (sent > 0 && usedFrom === "onboarding@resend.dev") {
        msg += "\n\n※ 발신이 onboarding으로 나옵니다. 이메일 템플릿에서 발신 주소를 저장한 뒤 다시 발송하거나, Supabase Edge Function 시크릿에 RESEND_FROM_EMAIL을 설정하세요. (Edge Function 재배포 필요할 수 있음)";
      }
      if (sent === 0 && errList.length > 0) {
        msg += "\n\n발송 실패 사유:\n" + errList.slice(0, 5).join("\n");
        const hasDomainError = errList.some((e) => /domain|verified|403|401|authorized/i.test(e));
        if (hasDomainError) {
          msg += "\n\n※ Resend 대시보드(https://resend.com/domains)에서 발신 도메인 인증이 완료되었는지 확인하세요. 인증 전에는 onboarding@resend.dev만 사용 가능합니다.";
        }
      }
      setMessage({ type: sent > 0 ? "ok" : "err", text: msg });
      fetchBrands();
      fetchEmailTemplates();
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
    } finally {
      setAction("idle");
    }
  };

  const runCrawler = async () => {
    if (crawlerServerOnline === false) {
      setMessage({
        type: "err",
        text: "크롤러 서버가 꺼져 있습니다.\n\nPC에서 start-crawler.bat을 실행하거나\npython crawler/server.py를 실행한 뒤 다시 시도하세요.",
      });
      return;
    }

    setAction("crawler");
    setMessage(null);
    setCrawlerElapsed(0);
    elapsedRef.current = setInterval(() => setCrawlerElapsed((p) => p + 1), 1000);

    try {
      const baseUrl = crawlerUrl.replace(/\/+$/, "");
      const res = await fetch(`${baseUrl}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: crawlerKeyword,
          pages: crawlerPages,
          skipNoEmail: crawlerSkipNoEmail,
        }),
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
      const err = e as Error;
      if (err.message === "Failed to fetch" || err.name === "TypeError") {
        setCrawlerServerOnline(false);
        setMessage({
          type: "err",
          text: "크롤러 서버가 꺼져 있습니다.\n\nPC에서 start-crawler.bat을 실행하거나\npython crawler/server.py를 실행한 뒤 다시 시도하세요.",
        });
      } else {
        setMessage({ type: "err", text: err.message });
      }
    } finally {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      elapsedRef.current = null;
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

  // 템플릿 저장 (수정 또는 새로 추가)
  const saveTemplate = async () => {
    setTplSaving(true);
    try {
      if (editingTemplateId && editingTemplateId !== "new") {
        const res = await fetch("/api/email-templates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingTemplateId,
            name: tplName,
            template_subject: tplSubject,
            template_html: tplHtml,
            from_email: tplFrom,
            inline_images: inlineImages,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "저장 실패");
        setMessage({ type: "ok", text: "템플릿이 수정되었습니다." });
      } else {
        const res = await fetch("/api/email-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: tplName || "새 템플릿",
            template_subject: tplSubject,
            template_html: tplHtml,
            from_email: tplFrom,
            inline_images: inlineImages,
            is_default: templates.length === 0,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "저장 실패");
        setMessage({ type: "ok", text: "템플릿이 추가되었습니다." });
      }
      setEditingTemplateId(null);
      setTplName("");
      setTplSubject("");
      setTplHtml("");
      setTplFrom("");
      setInlineImages([]);
      fetchEmailTemplates();
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
    } finally {
      setTplSaving(false);
    }
  };

  const cancelEditTemplate = () => {
    setEditingTemplateId(null);
    setTplName("");
    setTplSubject("");
    setTplHtml("");
    setTplFrom("");
    setInlineImages([]);
  };

  const startEditTemplate = (t: EmailTemplate) => {
    setEditingTemplateId(t.id);
    setTplName(t.name || "");
    setTplSubject(t.template_subject || "");
    setTplHtml(t.template_html || "");
    setTplFrom(t.from_email || "");
    setInlineImages(Array.isArray(t.inline_images) ? t.inline_images : []);
  };

  const startNewTemplate = () => {
    setEditingTemplateId("new");
    setTplName("");
    setTplSubject("[제안] {{업체명}} 맞춤 마케팅 제안");
    setTplHtml("<h2>{{업체명}} 담당자님께</h2>\n<p>안녕하세요.</p>\n<p>맞춤 제안을 드립니다.</p>\n<p>감사합니다.</p>");
    setTplFrom("onboarding@resend.dev");
    setInlineImages([]);
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm("이 템플릿을 삭제할까요?")) return;
    try {
      const res = await fetch(`/api/email-templates?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "삭제 실패");
      setMessage({ type: "ok", text: "템플릿이 삭제되었습니다." });
      if (editingTemplateId === id) {
        setEditingTemplateId(null);
        setTplName("");
        setTplSubject("");
        setTplHtml("");
        setTplFrom("");
        setInlineImages([]);
      }
      setSelectedTemplateId((prev) => (prev === id ? "" : prev));
      fetchEmailTemplates();
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
    }
  };

  const setDefaultTemplate = async (id: string) => {
    try {
      const res = await fetch("/api/email-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_default: true }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "설정 실패");
      setMessage({ type: "ok", text: "기본 템플릿으로 설정했습니다." });
      fetchEmailTemplates();
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
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

  const filteredBrands =
    statusFilter === "발송완료"
      ? brands.filter((b) => b.status === "발송완료")
      : brands;
  const canSelectBrand = (b: Brand) =>
    !!b.email && (b.status === "수집완료" || b.status === "발송대기");

  const toggleSelectAll = () => {
    const eligible = filteredBrands.filter(canSelectBrand);
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

  const eligibleCount = filteredBrands.filter(canSelectBrand).length;

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      `}</style>
      <h1 style={{ marginBottom: 8, fontSize: "1.5rem" }}>영업 메일링 대시보드</h1>
      <p style={{ color: "#64748b", marginBottom: 24 }}>
        브랜드 수집 → 발송 대상 선택 → 이메일 템플릿 작성 → 메일 발송
      </p>

      {/* 크롤러 */}
      <section style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <label htmlFor="crawler-keyword" style={{ fontWeight: 600 }}>키워드 수집</label>
          <span
            title={crawlerServerOnline === null ? "확인 중..." : crawlerServerOnline ? "크롤러 서버 ON" : "크롤러 서버 OFF"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
              background: crawlerServerOnline ? "#dcfce7" : crawlerServerOnline === false ? "#fee2e2" : "#f1f5f9",
              color: crawlerServerOnline ? "#166534" : crawlerServerOnline === false ? "#991b1b" : "#64748b",
            }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: crawlerServerOnline ? "#22c55e" : crawlerServerOnline === false ? "#ef4444" : "#94a3b8",
              animation: crawlerServerOnline ? "none" : crawlerServerOnline === false ? "none" : "pulse 1.5s infinite",
            }} />
            {crawlerServerOnline === null ? "확인 중" : crawlerServerOnline ? "서버 ON" : "서버 OFF"}
          </span>
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
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 12, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={crawlerSkipNoEmail} onChange={(e) => setCrawlerSkipNoEmail(e.target.checked)} />
            <span>이메일 없는 업체는 수집하지 않음</span>
          </label>
          <button
            onClick={runCrawler}
            disabled={action !== "idle" || crawlerServerOnline === false}
            style={{
              padding: "10px 20px",
              background: crawlerServerOnline === false ? "#d1d5db" : action === "crawler" ? "#94a3b8" : "#7c3aed",
              color: "#fff", border: "none", borderRadius: 8,
              cursor: action === "idle" && crawlerServerOnline !== false ? "pointer" : "not-allowed", fontWeight: 600,
            }}
          >
            {action === "crawler"
              ? `수집 중… ${Math.floor(crawlerElapsed / 60)}:${String(crawlerElapsed % 60).padStart(2, "0")}`
              : crawlerServerOnline === false
              ? "서버 OFF — 수집 불가"
              : `수집 실행 (${crawlerPages}페이지)`}
          </button>
          <button
            type="button"
            onClick={() => setShowCrawlerSettings(!showCrawlerSettings)}
            style={{ padding: "8px 12px", background: "none", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#64748b" }}
          >
            {showCrawlerSettings ? "설정 닫기" : "크롤러 서버 설정"}
          </button>
        </div>
        {action === "crawler" && (
          <div style={{
            padding: 16, background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe",
            marginBottom: 12, display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{
              display: "inline-block", width: 18, height: 18, border: "3px solid #3b82f6",
              borderTopColor: "transparent", borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#1e40af" }}>
                수집 진행 중 — {Math.floor(crawlerElapsed / 60)}분 {crawlerElapsed % 60}초 경과
              </div>
              <div style={{ fontSize: 12, color: "#3b82f6", marginTop: 2 }}>
                키워드: {crawlerKeyword || "자사몰"} / {crawlerPages}페이지 — 완료될 때까지 이 창을 유지하세요
              </div>
            </div>
          </div>
        )}
        {showCrawlerSettings && (
          <div style={{ padding: 12, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>크롤러 서버 URL</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                value={crawlerUrl}
                onChange={(e) => saveCrawlerUrl(e.target.value)}
                style={{ padding: "6px 10px", border: "1px solid #d4d4d8", borderRadius: 6, width: 280, fontSize: 13 }}
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch(`${crawlerUrl.replace(/\/+$/, "")}/health`);
                    const d = await res.json();
                    setMessage({ type: "ok", text: d.ok ? "크롤러 서버 연결 성공" : "응답이 올바르지 않습니다." });
                  } catch {
                    setMessage({ type: "err", text: "크롤러 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요." });
                  }
                }}
                style={{ padding: "6px 14px", background: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
              >
                연결 테스트
              </button>
            </div>
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, marginBottom: 0 }}>
              기본값: http://localhost:5000 — PC에서 python crawler/server.py 또는 start-crawler.bat 실행 필요
            </p>
          </div>
        )}
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
        {templates.length > 1 && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>발송 템플릿:</span>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0", minWidth: 140 }}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.is_default ? " (기본)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
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

      {/* 이메일 템플릿 (여러 개) */}
      {showTemplate && (
        <section style={{
          marginBottom: 24, padding: 24,
          background: "#faf5ff", borderRadius: 12,
          border: "1px solid #e9d5ff",
        }}>
          <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: "1.1rem" }}>이메일 템플릿</h3>
          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
            여러 명이 쓸 때: 각자 「+ 새 템플릿 추가」로 템플릿을 만든 뒤, 발신 이메일 주소에 본인 이메일을 넣고 저장하세요. 발송 시 「발송 템플릿」에서 해당 템플릿을 선택하면 그 주소로 발송됩니다.
          </p>

          {/* 템플릿 목록 */}
          {templates.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {templates.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      background: editingTemplateId === t.id ? "#ede9fe" : "#f5f3ff",
                      borderRadius: 8,
                      border: editingTemplateId === t.id ? "2px solid #7c3aed" : "1px solid #e9d5ff",
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{t.name}{t.is_default ? " (기본)" : ""}</span>
                    <button type="button" onClick={() => startEditTemplate(t)} style={{ padding: "4px 8px", fontSize: 12, cursor: "pointer", border: "1px solid #a78bfa", borderRadius: 6, background: "#fff" }}>편집</button>
                    {!t.is_default && (
                      <button type="button" onClick={() => setDefaultTemplate(t.id)} style={{ padding: "4px 8px", fontSize: 12, cursor: "pointer", border: "1px solid #a78bfa", borderRadius: 6, background: "#fff" }}>기본으로</button>
                    )}
                    <button type="button" onClick={() => deleteTemplate(t.id)} style={{ padding: "4px 8px", fontSize: 12, cursor: "pointer", border: "1px solid #f87171", borderRadius: 6, background: "#fef2f2", color: "#991b1b" }}>삭제</button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={startNewTemplate} style={{ padding: "8px 14px", fontSize: 13, cursor: "pointer", border: "1px dashed #a78bfa", borderRadius: 8, background: "#fff", color: "#6d28d9", fontWeight: 600 }}>+ 새 템플릿 추가</button>
            </div>
          )}

          {/* 편집/추가 폼 */}
          {(editingTemplateId !== null || templates.length === 0) && (
            <>
              <h4 style={{ marginBottom: 12, fontSize: "0.95rem" }}>{editingTemplateId && editingTemplateId !== "new" ? "템플릿 수정" : "새 템플릿 추가"}</h4>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>템플릿 이름</label>
                <input
                  type="text"
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="예: 기본 제안서, A팀용 등"
                  style={{ padding: "8px 12px", border: "1px solid #d4d4d8", borderRadius: 8, width: "100%", maxWidth: 320 }}
                />
              </div>
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
              자체 도메인(예: xxx@one-ad.co.kr) 사용 시 Resend에서 해당 도메인 인증이 완료되어야 발송됩니다. 인증 전에는 onboarding@resend.dev만 사용 가능합니다. Resend → Domains에서 DNS 설정 후 인증 완료하세요.
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

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
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
              {tplSaving ? "저장 중…" : editingTemplateId && editingTemplateId !== "new" ? "수정 저장" : "템플릿 추가"}
            </button>
            {(editingTemplateId !== null || templates.length > 0) && (
              <button type="button" onClick={cancelEditTemplate} style={{ padding: "10px 24px", background: "#e2e8f0", color: "#475569", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                취소
              </button>
            )}
          </div>
            </>
          )}
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

      {/* 목록 필터: 전체 | 발송완료만 */}
      {!loading && brands.length > 0 && (
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>표시:</span>
          <button
            type="button"
            onClick={() => setStatusFilter("전체")}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: statusFilter === "전체" ? "#e2e8f0" : "#fff",
              cursor: "pointer",
              fontWeight: statusFilter === "전체" ? 600 : 400,
            }}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("발송완료")}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: statusFilter === "발송완료" ? "#dcfce7" : "#fff",
              cursor: "pointer",
              fontWeight: statusFilter === "발송완료" ? 600 : 400,
            }}
          >
            발송완료만
          </button>
        </div>
      )}

      {/* 브랜드 테이블 */}
      {loading ? (
        <p>목록 조회 중…</p>
      ) : brands.length === 0 ? (
        <p style={{ color: "#64748b" }}>
          브랜드가 없습니다. 위에서 키워드를 입력하고 「수집 실행」 후 1~2분 뒤 새로고침하세요.
        </p>
      ) : filteredBrands.length === 0 ? (
        <p style={{ color: "#64748b" }}>
          {statusFilter === "발송완료" ? "발송완료 건이 없습니다." : "표시할 브랜드가 없습니다."}
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
                    title="이메일 있는 수집완료·발송대기 선택 (재발송 가능)"
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
              {filteredBrands.map((b) => {
                const sc = statusColor(b.status);
                const canSelect = canSelectBrand(b);
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

import { NextResponse } from "next/server";
import { exec, ExecOptions } from "child_process";
import path from "path";
import fs from "fs";
import { promisify } from "util";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
    const pages = typeof body?.pages === "number" && body.pages >= 1 ? Math.min(body.pages, 10) : 1;
    const skipNoEmail = !!body?.skipNoEmail;

    // (1) 비용 없음: GitHub Actions로 크롤러 실행
    const ghRepo = process.env.GITHUB_ACTIONS_CRAWLER_REPO?.trim(); // 예: owner/repo
    const ghToken = process.env.GITHUB_ACTIONS_CRAWLER_TOKEN?.trim();
    if (ghRepo && ghToken) {
      const parts = ghRepo.split("/").map((p) => p.trim()).filter(Boolean);
      const owner = parts[0];
      const repo = parts[1];
      if (owner && repo) {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/workflows/run-crawler.yml/dispatches`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ghToken}`,
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ref: process.env.GITHUB_ACTIONS_CRAWLER_REF?.trim() || "main",
              inputs: {
                keyword: keyword || "자사몰",
                pages: String(pages),
                skip_no_email: skipNoEmail ? "true" : "false",
              },
            }),
          }
        );
        if (res.status === 204) {
          return NextResponse.json({
            message: "수집이 백그라운드에서 시작되었습니다. 2~3분 후 목록을 새로고침하세요.",
            insertedCount: undefined,
            log: "(GitHub Actions에서 실행 중)",
          });
        }
        const errText = await res.text();
        return NextResponse.json(
          { error: "GitHub Actions 트리거 실패", detail: errText.slice(0, 500) },
          { status: res.status }
        );
      }
    }

    // (2) Railway 등 크롤러 전용 서비스 URL이 있으면 그쪽으로 프록시
    const crawlerServiceUrl = process.env.CRAWLER_SERVICE_URL?.trim();
    if (crawlerServiceUrl) {
      const url = `${crawlerServiceUrl.replace(/\/$/, "")}/run`;
      const secret = process.env.CRAWLER_SERVICE_SECRET?.trim();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (secret) headers["Authorization"] = `Bearer ${secret}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ keyword, pages, skipNoEmail }),
        signal: AbortSignal.timeout(280000),
      });
      const text = await res.text();
      let data: unknown;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: "응답 파싱 실패", detail: text.slice(0, 500) }; }
      if (!res.ok) {
        const err = data as { error?: string; detail?: string };
        return NextResponse.json(
          { error: err?.error || "크롤러 서비스 오류", detail: err?.detail || text?.slice(-800) },
          { status: res.status }
        );
      }
      return NextResponse.json(data as Record<string, unknown>);
    }

    // Vercel 등 서버리스에서는 Python 실행 불가 → 환경 변수 없으면 안내 반환
    if (process.env.VERCEL === "1") {
      const repoStatus = process.env.GITHUB_ACTIONS_CRAWLER_REPO?.trim() ? "설정됨" : "비어있음";
      const tokenStatus = process.env.GITHUB_ACTIONS_CRAWLER_TOKEN?.trim() ? "설정됨" : "비어있음";
      return NextResponse.json(
        {
          error: "크롤러 설정이 적용되지 않았습니다.",
          detail: [
            "Vercel에서는 Python을 실행할 수 없습니다. 아래 상태를 확인하세요.",
            "",
            `[진단] GITHUB_ACTIONS_CRAWLER_REPO: ${repoStatus}`,
            `[진단] GITHUB_ACTIONS_CRAWLER_TOKEN: ${tokenStatus}`,
            "",
            "둘 다 '설정됨'이어야 합니다. 비어있음이 있으면:",
            "1) Settings → Environment Variables에서 값 확인 (이름 오타 없이)",
            "2) Production 체크 후 Save",
            "3) Deployments → 최신 배포 ⋮ → Redeploy (환경 변수 변경 후 필수)",
          ].join("\n"),
        },
        { status: 503 }
      );
    }

    const projectRoot = path.resolve(process.cwd(), "..");
    const scriptPath = path.join(projectRoot, "crawler", "brand_crawler.py");
    const scriptRel = "crawler/brand_crawler.py";

    if (!fs.existsSync(scriptPath)) {
      const msg = `크롤러 스크립트를 찾을 수 없습니다. 경로: ${scriptPath} (현재 cwd: ${process.cwd()})`;
      console.error("[run-crawler]", msg);
      return NextResponse.json({ error: "스크립트 없음", detail: msg }, { status: 500 });
    }
    const baseArgs = keyword ? [scriptRel, keyword] : [scriptRel];
    const extraArgs = pages > 1 ? ["--pages", String(pages)] : [];
    if (skipNoEmail) extraArgs.push("--skip-no-email");
    const args = [...baseArgs, ...extraArgs];
    const argsStr = args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(" ");

    const tryRun = async (pythonCmd: string) => {
      const cmd = `${pythonCmd} ${argsStr}`;
      const opts: ExecOptions = {
        cwd: projectRoot,
        timeout: 280000,
        maxBuffer: 2 * 1024 * 1024,
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
        encoding: "utf8",
      };
      return execAsync(cmd, opts);
    };

    let stdout = "";
    let stderr = "";
    let lastErr: unknown = null;

    for (const pythonCmd of process.platform === "win32" ? ["python", "py"] : ["python3", "python"]) {
      try {
        const result = await tryRun(pythonCmd);
        stdout = (typeof result.stdout === "string" ? result.stdout : result.stdout?.toString?.() ?? "").trim();
        stderr = (typeof result.stderr === "string" ? result.stderr : result.stderr?.toString?.() ?? "").trim();
        if (stderr && !stdout) {
          return NextResponse.json(
            { error: "크롤러 실행 오류", detail: stderr.slice(-800) },
            { status: 500 }
          );
        }
        const lastLine = stdout.split("\n").filter(Boolean).pop() || "";
        const insertedMatch = stdout.match(/INSERTED_COUNT=(\d+)/);
        const insertedCount = insertedMatch ? parseInt(insertedMatch[1], 10) : undefined;
        return NextResponse.json({
          message: lastLine.includes("insert")
            ? lastLine
            : keyword
            ? `크롤러 완료. (키워드: ${keyword}) 새로고침하세요.`
            : "크롤러 완료. 새로고침하세요.",
          insertedCount,
          log: stdout.slice(-800),
        });
      } catch (execErr: unknown) {
        lastErr = execErr;
        const err = execErr as { message?: string; stderr?: string; stdout?: string; killed?: boolean; code?: number };
        if (err.code === 1 || err.code === 2) {
          stderr = err.stderr || "";
          stdout = err.stdout || "";
          break;
        }
      }
    }

    const err = lastErr as { message?: string; stderr?: string; stdout?: string; killed?: boolean };
    let detail = "";
    if (stderr) detail += "[stderr]\n" + stderr.slice(-1200);
    if (stdout) detail += (detail ? "\n\n[stdout]\n" : "[stdout]\n") + stdout.slice(-600);
    if (!detail) {
      detail = err?.message || "";
      if (err?.stderr) detail += "\n[stderr]\n" + String(err.stderr).slice(-1000);
      if (err?.stdout) detail += "\n[stdout]\n" + String(err.stdout).slice(-500);
    }
    if (err?.killed) detail += "\n(시간 초과로 종료됨. 키워드당 수집 건수를 줄이거나, 터미널에서 직접 실행해 보세요.)";
    if (!detail) detail = "Python 실행 실패.";
    detail += "\n\n터미널에서 직접 실행: cd \"영업 메일링\" 후 python3 crawler/brand_crawler.py 키워드 (Linux/Mac) 또는 python crawler/brand_crawler.py (Windows)";
    console.error("[run-crawler]", detail.slice(-1500));
    return NextResponse.json(
      { error: "크롤러 실행 실패", detail: detail.slice(-2000) },
      { status: 500 }
    );
  } catch (e) {
    const err = e as Error;
    const detail = err.stack || err.message;
    console.error("[run-crawler] 예외:", detail);
    return NextResponse.json(
      { error: err.message, detail: detail?.slice(-1500) },
      { status: 500 }
    );
  }
}

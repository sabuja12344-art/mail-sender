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

    for (const pythonCmd of process.platform === "win32" ? ["python", "py"] : ["python"]) {
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
    detail += "\n\n터미널에서 직접 실행: cd \"영업 메일링\" 후 python crawler/brand_crawler.py 키워드";
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

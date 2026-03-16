import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// 프로젝트 루트 (web 폴더의 상위)
const PROJECT_ROOT = path.resolve(process.cwd(), "..");

export async function POST() {
  try {
    const batPath = path.join(PROJECT_ROOT, "start-crawler.bat");
    if (!fs.existsSync(batPath)) {
      return NextResponse.json({ error: "start-crawler.bat 파일을 찾을 수 없습니다." }, { status: 404 });
    }

    // 이미 실행 중인지 확인
    try {
      const health = await fetch("http://localhost:5000/health", {
        signal: AbortSignal.timeout(1500),
      });
      if (health.ok) {
        return NextResponse.json({ ok: true, message: "크롤러 서버가 이미 실행 중입니다." });
      }
    } catch {
      // 서버가 꺼져 있으면 아래에서 실행
    }

    // start-crawler.bat을 별도 창으로 실행
    const child = spawn("cmd.exe", ["/c", "start", '""', batPath], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();

    return NextResponse.json({ ok: true, message: "크롤러 서버를 시작했습니다. 잠시 후 서버 ON으로 바뀝니다." });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

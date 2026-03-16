import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ids = searchParams.get("ids"); // 콤마 구분 brand ID 목록 (없으면 전체)
  const statusFilter = searchParams.get("status"); // 선택적 상태 필터

  try {
    let query = supabase
      .from("brands")
      .select("name, email, website_url, status, search_keyword, pixel_installed, created_at")
      .order("created_at", { ascending: false });

    if (ids) {
      const idList = ids.split(",").map((s) => s.trim()).filter(Boolean);
      if (idList.length > 0) query = query.in("id", idList);
    }
    if (statusFilter && statusFilter !== "전체") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];

    // UTF-8 BOM + CSV 생성 (엑셀에서 한글 깨짐 방지)
    const headers = ["브랜드명", "이메일", "웹사이트", "상태", "검색키워드", "픽셀설치", "수집일시"];
    const csvLines = [
      headers.join(","),
      ...rows.map((r) =>
        [
          csvEscape(r.name ?? ""),
          csvEscape(r.email ?? ""),
          csvEscape(r.website_url ?? ""),
          csvEscape(r.status ?? ""),
          csvEscape(r.search_keyword ?? ""),
          r.pixel_installed ? "O" : "X",
          csvEscape(r.created_at ? r.created_at.slice(0, 10) : ""),
        ].join(",")
      ),
    ];

    const BOM = "\uFEFF"; // UTF-8 BOM
    const csv = BOM + csvLines.join("\r\n");

    const now = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="brands_${now}.csv"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

function csvEscape(val: string): string {
  // 콤마, 줄바꿈, 큰따옴표 포함 시 큰따옴표로 감싸기
  if (val.includes(",") || val.includes("\n") || val.includes('"')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

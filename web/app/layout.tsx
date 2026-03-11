export const metadata = {
  title: "영업 메일링 대시보드",
  description: "브랜드 수집 · AI 제안 생성 · 메일 발송 운영",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
        {children}
      </body>
    </html>
  );
}

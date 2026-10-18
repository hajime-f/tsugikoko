import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";

export const metadata: Metadata = {
  title: "ツギココ | 気になったら、ツギココ",
  description:
    "SNSで見かけたお店も、通りすがりに気になったお店も。行きたい飲食店・カフェを残して、次のお出かけをもっと楽しみに。",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" data-scroll-behavior="smooth">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}

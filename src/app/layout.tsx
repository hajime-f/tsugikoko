import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";
import { SITE_URL } from "@/lib/site";
import { Analytics } from "@/components/analytics/analytics";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "ツギココ | 気になったら、ツギココ",
  description:
    "SNSで見かけたお店も、通りすがりに気になったお店も。行きたい飲食店・カフェを残して、次のお出かけをもっと楽しみに。",
  robots: { index: false, follow: false },
  other: { "google-adsense-account": "ca-pub-9669747563254817" },
  openGraph: {
    type: "website", locale: "ja_JP", siteName: "ツギココ", url: SITE_URL,
    title: "ツギココ | 気になったら、ツギココ",
    description: "行きたい飲食店・カフェを残して、次のお出かけをもっと楽しみに。",
    images: [{ url: "/images/landing/hero.webp", alt: "ツギココ" }],
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" data-scroll-behavior="smooth">
      <head>
        {/* Google tag (gtag.js) */}
        <script id="tsugikoko-google-ads" async src="https://www.googletagmanager.com/gtag/js?id=AW-18532065959" />
        <script id="tsugikoko-google-ads-config" dangerouslySetInnerHTML={{ __html: `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'AW-18532065959');
` }} />
      </head>
      <body><Analytics /><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}

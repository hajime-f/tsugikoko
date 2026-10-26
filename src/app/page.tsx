import { LandingPage } from "@/components/landing/landing-page";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: SITE_URL },
  robots: { index: true, follow: true },
};

export default function Home() {
  return <LandingPage />;
}

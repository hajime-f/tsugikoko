"use client";

import Image from "next/image";
import Link from "next/link";
import { adsenseConfigured } from "@/components/analytics/adsense";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MapPin } from "lucide-react";
import { AuthPanel } from "./auth-panel";
import { useAuth } from "./auth-provider";
import { trackCtaClick } from "@/lib/analytics";
import { readPendingDraft } from "@/lib/auth/draft";

export function LoginPage() {
  const { user, loading, clearError } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [draftUrl, setDraftUrl] = useState("");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "signup") setMode("signup");
    setDraftUrl(readPendingDraft());
  }, []);
  const router = useRouter();
  useEffect(() => { if (!loading && user) router.replace("/home"); }, [user, loading, router]);
  return <main className="login-page">
    <div className="login-art"><Image src="/images/landing/brunch.webp" alt="次の休日に楽しみたいブランチ" fill preload sizes="(max-width: 700px) 100vw, 50vw" /><div><p>YOUR NEXT GOOD PLACE.</p><h2>気になったら、<br />ツギココ。</h2></div></div>
    <div className="login-main">
      <Link className="back-link" href="/" onClick={event => { if (adsenseConfigured) { event.preventDefault(); window.location.assign("/"); } }}><ArrowLeft size={18} />トップページへ</Link>
      <div className="login-card">
        <span className="modal-brand"><MapPin size={30} aria-hidden="true" /></span>
        <h1>{mode === "login" ? "おかえりなさい。" : "次の楽しみを、ひとつ。"}</h1>
        <p className="login-description">{mode === "login" ? "あなたの「行きたい」が待っています。" : "いつものアカウントで、ツギココをはじめる。"}</p>
        <AuthPanel mode={mode} draftUrl={draftUrl} />
        <button className="auth-mode-switch" onClick={() => { trackCtaClick(mode === "login" ? "login_mode_signup" : "login_mode_login"); clearError(); setMode(mode === "login" ? "signup" : "login"); }}>{mode === "login" ? "初めての方はこちら" : "アカウントをお持ちの方はこちら"}</button>
      </div>
      <p className="login-footer">ツギココ / 気になるお店を、次の楽しみに。</p>
    </div>
  </main>;
}

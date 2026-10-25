"use client";

import { useEffect, useState } from "react";

export function DeletionReceipt() {
  const [accepted, setAccepted] = useState(false);
  useEffect(() => { setAccepted(new URLSearchParams(window.location.search).get("requested") === "1"); }, []);
  return accepted ? <div className="deletion-receipt" role="status"><h2>退会を受け付けました</h2><p>この端末からログアウトしました。数分後から順次データを削除します。この画面を閉じても処理は続きます。</p><p>これは受付のご案内です。削除の完了通知ではありません。処理状況についてのお問い合わせは、下記の窓口で受け付けています。</p></div> : null;
}

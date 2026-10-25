"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getAdditionalUserInfo, linkWithPopup, onAuthStateChanged, reauthenticateWithPopup, signInWithPopup, signOut, unlink, type User } from "firebase/auth";
import { getClientAuth } from "@/lib/firebase/client";
import { authErrorMessage, createProvider, isProviderEnabled, type ProviderId } from "@/lib/auth/providers";
import { claimPendingDraft, clearDraft } from "@/lib/auth/draft";
import { trackSignUp } from "@/lib/analytics";

type AuthContextValue = {
  user: User | null; loading: boolean; busy: boolean; error: string; providerIds: string[];
  clearError: () => void;
  login: (id: ProviderId) => Promise<boolean>;
  logout: () => Promise<boolean>;
  link: (id: ProviderId) => Promise<boolean>;
  unlinkProvider: (id: ProviderId) => Promise<boolean>;
  reauthenticate: (id: ProviderId) => Promise<boolean>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inProgress = useRef(false);
  const previousUid = useRef<string | null>(null);

  useEffect(() => {
    try {
      return onAuthStateChanged(getClientAuth(), (currentUser) => {
        if (previousUid.current && previousUid.current !== currentUser?.uid) clearDraft(previousUid.current);
        previousUid.current = currentUser?.uid ?? null;
        if (currentUser) claimPendingDraft(currentUser.uid);
        setUser(currentUser);
        setProviderIds(currentUser?.providerData.map((p) => p.providerId) ?? []);
        setLoading(false);
      }, (cause) => { setError(authErrorMessage(cause)); setLoading(false); });
    } catch (cause) { setError(authErrorMessage(cause)); setLoading(false); }
  }, []);

  async function perform(action: () => Promise<unknown>) {
    if (inProgress.current || loading) return false;
    inProgress.current = true;
    setError(""); setBusy(true);
    try {
      await action();
      setProviderIds(getClientAuth().currentUser?.providerData.map((p) => p.providerId) ?? []);
      return true;
    } catch (cause) { setError(authErrorMessage(cause)); return false; }
    finally { inProgress.current = false; setBusy(false); }
  }

  const value: AuthContextValue = {
    user, loading, busy, error, providerIds, clearError: () => setError(""),
    login: (id) => perform(async () => {
      if (!isProviderEnabled(id)) throw { code: "auth/operation-not-allowed" };
      const result = await signInWithPopup(getClientAuth(), createProvider(id));
      if (getAdditionalUserInfo(result)?.isNewUser) trackSignUp(id);
    }),
    logout: () => perform(async () => {
      const uid = getClientAuth().currentUser?.uid;
      await signOut(getClientAuth());
      if (uid) clearDraft(uid);
    }),
    link: (id) => perform(async () => {
      const currentUser = getClientAuth().currentUser;
      if (!currentUser || !isProviderEnabled(id)) throw { code: "auth/operation-not-allowed" };
      await linkWithPopup(currentUser, createProvider(id));
    }),
    unlinkProvider: (id) => perform(async () => {
      const currentUser = getClientAuth().currentUser;
      if (!currentUser || currentUser.providerData.length < 2) throw { code: "auth/operation-not-allowed" };
      await unlink(currentUser, id);
    }),
    reauthenticate: (id) => perform(async () => {
      const currentUser = getClientAuth().currentUser;
      if (!currentUser || !isProviderEnabled(id) || !currentUser.providerData.some(provider => provider.providerId === id)) throw { code: "auth/operation-not-allowed" };
      await reauthenticateWithPopup(currentUser, createProvider(id));
      await currentUser.getIdToken(true);
    }),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is required.");
  return value;
}

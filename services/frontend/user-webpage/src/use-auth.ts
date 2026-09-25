import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import { ApiError, signIn, signOut, type Session } from "./api";
import {
  browserSessionStore,
  isTemporaryAuthError,
  loadIdentity,
  renewIdentity,
  restoreIdentity,
  type Identity,
} from "./auth-session";
import { sessionRefreshDelayMs } from "./session";
import { getErrorMessage } from "./view-model";
import { sameAccount } from "./workspace-revisions";

type SessionTask = (save: (session: Session) => Session) => Promise<Identity | null>;

export function useAuth() {
  const [store] = useState(browserSessionStore);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const operation = useRef(0);
  const mounted = useRef(false);
  const pendingAuth = useRef<Promise<void> | null>(null);
  const session = identity?.session;

  // StrictMode may replay effects. Share one task so a refresh token is exchanged only once.
  const runSessionTask = useCallback(
    (task: SessionTask) => {
      if (pendingAuth.current) return pendingAuth.current;
      const generation = ++operation.current;
      const current = () => mounted.current && generation === operation.current;
      const save = (next: Session) => {
        if (!current()) throw new DOMException("Session operation was replaced", "AbortError");
        return store.write(next);
      };
      const pending = task(save)
        .then((next) => {
          if (!current()) return;
          setIdentity(next);
          setAuthError(null);
          setRestoreError(null);
        })
        .catch((error: unknown) => {
          if (!current()) return;
          setIdentity(null);
          if (isTemporaryAuthError(error)) {
            setRestoreError(`Could not restore your session: ${getErrorMessage(error)}`);
          } else {
            store.clear();
            setRestoreError(null);
            setAuthError(`Please sign in again: ${getErrorMessage(error)}`);
          }
        })
        .finally(() => {
          if (current()) setIsRestoring(false);
          if (pendingAuth.current === pending) pendingAuth.current = null;
        });
      pendingAuth.current = pending;
      return pending;
    },
    [store],
  );

  const restoreSavedSession = useCallback(
    () =>
      runSessionTask(async (save) => {
        const saved = store.read();
        return saved ? restoreIdentity(saved, save) : null;
      }),
    [runSessionTask, store],
  );

  useEffect(() => {
    mounted.current = true;
    void restoreSavedSession();
    return () => {
      mounted.current = false;
    };
  }, [restoreSavedSession]);

  useEffect(() => {
    if (!session || isSigningOut) return;
    const timeout = window.setTimeout(() => {
      void runSessionTask((save) => renewIdentity(session, save));
    }, sessionRefreshDelayMs(session));
    return () => {
      window.clearTimeout(timeout);
    };
  }, [session, isSigningOut, runSessionTask]);

  function retryRestore() {
    setIsRestoring(true);
    setRestoreError(null);
    return restoreSavedSession();
  }

  function discardStoredSession() {
    ++operation.current;
    pendingAuth.current = null;
    store.clear();
    setIdentity(null);
    setPassword("");
    setIsRestoring(false);
    setRestoreError(null);
    setAuthError(null);
  }

  async function handleSignIn(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSigningIn || isSigningOut || isRestoring) return;
    const generation = ++operation.current;
    const current = () => mounted.current && generation === operation.current;
    setIsSigningIn(true);
    setAuthError(null);
    setRestoreError(null);
    setIdentity(null);
    store.clear();
    let saved: Session | null = null;
    try {
      const received = await signIn(email.trim(), password);
      if (!current()) return;
      saved = store.write(received);
      setPassword("");
      const next = await loadIdentity(saved);
      if (current()) setIdentity(next);
    } catch (error) {
      if (!current()) return;
      if (saved && isTemporaryAuthError(error)) {
        setRestoreError(`Could not restore your session: ${getErrorMessage(error)}`);
      } else {
        store.clear();
        setAuthError(getErrorMessage(error));
      }
    } finally {
      if (current()) setIsSigningIn(false);
    }
  }

  async function handleSignOut() {
    if (!session || isSigningOut) return;
    const accessToken = session.access_token;
    discardStoredSession();
    const generation = operation.current;
    const current = () => mounted.current && generation === operation.current;
    setIsSigningOut(true);
    try {
      await signOut(accessToken);
    } catch (error) {
      if (current()) setAuthError(`Could not complete sign out: ${getErrorMessage(error)}`);
    } finally {
      if (current()) setIsSigningOut(false);
    }
  }

  async function refreshIdentity(): Promise<boolean> {
    if (!identity || isSigningOut || pendingAuth.current) return false;
    const generation = operation.current;
    try {
      const next = await loadIdentity(identity.session);
      if (!mounted.current || generation !== operation.current) return false;
      setIdentity(next);
      return sameAccount(next.account, identity.account);
    } catch (error) {
      if (!mounted.current || generation !== operation.current) return false;
      if (isTemporaryAuthError(error)) throw error;
      if (error instanceof ApiError && error.status === 401) {
        await runSessionTask((save) => renewIdentity(identity.session, save));
      } else {
        discardStoredSession();
        setAuthError(`Please sign in again: ${getErrorMessage(error)}`);
      }
      return false;
    }
  }

  return {
    email,
    setEmail,
    password,
    setPassword,
    identity,
    isSigningIn,
    isSigningOut,
    isRestoring,
    restoreError,
    authError,
    handleSignIn,
    handleSignOut,
    refreshIdentity,
    retryRestore,
    discardStoredSession,
  };
}

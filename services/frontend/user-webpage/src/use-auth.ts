import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import { flushSync } from "react-dom";
import { ApiError, fetchSessionUser, signIn, signUp, signOut, type Session } from "./api";
import {
  browserSessionStore,
  isTemporaryAuthError,
  loadIdentity,
  renewIdentity,
  restoreIdentity,
  type Identity,
  type IdentityRefreshOptions,
} from "./auth-session";
import { sessionRefreshDelayMs } from "./session";
import { getErrorMessage } from "./view-model";
import { sameAccount } from "./workspace-revisions";
import { clearBrowserWorkspace } from "./workspace-browser-storage";
import { takeEmailConfirmation } from "./email-confirmation";

type SessionTask = (save: (session: Session) => Session) => Promise<Identity | null>;

export function useAuth() {
  const [store] = useState(browserSessionStore);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const latestIdentity = useRef<Identity | null>(null);
  const identityLoad = useRef(0);
  const updateIdentity = useCallback((next: Identity | null) => {
    latestIdentity.current = next;
    setIdentity(next);
  }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const operation = useRef(0);
  const mounted = useRef(false);
  const pendingAuth = useRef<Promise<void> | null>(null);
  const pendingConfirmation = useRef<ReturnType<typeof takeEmailConfirmation>>(null);
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
          updateIdentity(next);
          setAuthError(null);
          setRestoreError(null);
        })
        .catch((error: unknown) => {
          if (!current()) return;
          updateIdentity(null);
          if (isTemporaryAuthError(error)) {
            setRestoreError(`Could not restore your session: ${getErrorMessage(error)}`);
          } else {
            pendingConfirmation.current = null;
            store.clear();
            clearBrowserWorkspace();
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
    [store, updateIdentity],
  );

  const restoreSavedSession = useCallback(
    () =>
      runSessionTask(async (save) => {
        const confirmation = pendingConfirmation.current ?? takeEmailConfirmation();
        if (confirmation) {
          pendingConfirmation.current = confirmation;
          clearBrowserWorkspace();
          store.clear();
          const user = await fetchSessionUser(confirmation.access_token);
          const saved = save({ ...confirmation, user });
          pendingConfirmation.current = null;
          return loadIdentity(saved);
        }
        const saved = store.read();
        if (!saved) clearBrowserWorkspace();
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
      const current = latestIdentity.current;
      if (current?.session !== session) return;
      void runSessionTask((save) => renewIdentity(current.session, save, { previous: current }));
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
    pendingConfirmation.current = null;
    store.clear();
    clearBrowserWorkspace();
    updateIdentity(null);
    setPassword("");
    setIsRestoring(false);
    setRestoreError(null);
    setAuthError(null);
    setAuthStatus(null);
    setAuthMode("sign-in");
  }

  function changeAuthMode(mode: "sign-in" | "sign-up") {
    if (isSubmitting) return;
    setAuthMode(mode);
    setPassword("");
    setAuthError(null);
    setAuthStatus(null);
  }

  async function handleAuthenticate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || isSigningOut || isRestoring) return;
    const generation = ++operation.current;
    const current = () => mounted.current && generation === operation.current;
    setIsSubmitting(true);
    setAuthError(null);
    setAuthStatus(null);
    setRestoreError(null);
    updateIdentity(null);
    store.clear();
    clearBrowserWorkspace();
    let saved: Session | null = null;
    try {
      const received =
        authMode === "sign-up"
          ? await signUp(
              email.trim(),
              password,
              `${window.location.origin}${window.location.pathname}`,
            )
          : await signIn(email.trim(), password);
      if (!current()) return;
      setPassword("");
      if (!received) {
        setAuthMode("sign-in");
        setAuthStatus(
          "If this address needs confirmation, you’ll receive an email with a confirmation link. Open it to continue, or sign in below if your email is already confirmed.",
        );
        return;
      }
      saved = store.write(received);
      const next = await loadIdentity(saved);
      if (current()) updateIdentity(next);
    } catch (error) {
      if (!current()) return;
      if (saved && isTemporaryAuthError(error)) {
        setRestoreError(`Could not restore your session: ${getErrorMessage(error)}`);
      } else {
        store.clear();
        setAuthError(
          authMode === "sign-up" &&
            error instanceof ApiError &&
            [400, 422].includes(error.status ?? 0)
            ? "Could not create an account with these details. Try signing in if you already have an account."
            : getErrorMessage(error),
        );
      }
    } finally {
      if (current()) setIsSubmitting(false);
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

  async function refreshIdentity(options: IdentityRefreshOptions = {}): Promise<boolean> {
    const previous = latestIdentity.current;
    if (!previous || isSigningOut || pendingAuth.current) return false;
    const generation = operation.current;
    const load = ++identityLoad.current;
    const current = () =>
      mounted.current && generation === operation.current && load === identityLoad.current;
    try {
      const next = await loadIdentity(previous.session, { previous, ...options });
      if (!current()) return false;
      // Commit fresh catalogs and their search keys before revision-driven query refetches.
      flushSync(() => {
        updateIdentity(next);
      });
      return sameAccount(next.account, previous.account);
    } catch (error) {
      if (!current()) return false;
      if (isTemporaryAuthError(error)) throw error;
      if (error instanceof ApiError && error.status === 401) {
        await runSessionTask((save) =>
          renewIdentity(previous.session, save, { previous, ...options }),
        );
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
    authMode,
    changeAuthMode,
    authStatus,
    identity,
    isSubmitting,
    isSigningOut,
    isRestoring,
    restoreError,
    authError,
    handleAuthenticate,
    handleSignOut,
    refreshIdentity,
    retryRestore,
    discardStoredSession,
  };
}

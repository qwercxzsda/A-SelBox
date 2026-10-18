import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import { flushSync } from "react-dom";
import {
  ApiError,
  requestPasswordRecovery,
  updatePassword,
  signIn,
  signUp,
  signOut,
  type Session,
} from "./api";
import {
  browserSessionStore,
  isTemporaryAuthError,
  loadIdentity,
  renewIdentity,
  type Identity,
  type IdentityRefreshOptions,
} from "./auth-session";
import { sessionRefreshDelayMs } from "./session";
import { getErrorMessage } from "./view-model";
import { sameAccount } from "./workspace-revisions";
import { clearBrowserWorkspace } from "./workspace-browser-storage";
import { AuthCallbackError, takeAuthCallback } from "./auth-callback";
import { bootstrapAuthCallback } from "./auth-callback-storage";
import { verifyRecoverySession } from "./auth-recovery";
import { restoreAuthentication } from "./auth-restoration";
import { clearWorkspaceLocation } from "./workspace-location-cleanup";

type SessionTask = (save: (session: Session) => Session) => Promise<Identity | null>;
type AuthMode = "sign-in" | "sign-up" | "recover";
const callbackBootstrap = bootstrapAuthCallback();
const callbackStore = callbackBootstrap.store;

export function useAuth() {
  const [store] = useState(browserSessionStore);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>(() =>
    callbackStore.read().recovery?.stage === "request" ? "recover" : "sign-in",
  );
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [authStatusTitle, setAuthStatusTitle] = useState("Check your email");
  const [recoverySession, setRecoverySession] = useState<Session | null>(null);
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
  const callbackError = useRef(callbackBootstrap.error);
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
            const flow = callbackStore.read();
            const recovery =
              flow.pending?.kind === "recovery" ||
              flow.recovery?.stage === "password" ||
              (error instanceof AuthCallbackError && error.recovery);
            callbackStore.clear();
            setRecoverySession(null);
            store.clear();
            clearBrowserWorkspace();
            setRestoreError(null);
            if (recovery) {
              callbackStore.write({ pending: null, recovery: { stage: "request" } });
              setAuthMode("recover");
              setAuthError(
                "This recovery link is invalid or has expired. Request a new link below.",
              );
            } else {
              setAuthError(`Please sign in again: ${getErrorMessage(error)}`);
            }
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
        if (callbackError.current) {
          const error = callbackError.current;
          callbackError.current = null;
          throw error instanceof Error
            ? error
            : new Error("This account link could not be verified.");
        }
        const restored = await restoreAuthentication(store, callbackStore, save);
        if (restored.kind === "recovery") {
          setRecoverySession(restored.session);
          return null;
        }
        return restored.identity;
      }),
    [runSessionTask, store],
  );

  useEffect(() => {
    mounted.current = true;
    void restoreSavedSession();
    const onAuthCallback = () => {
      try {
        const callback = takeAuthCallback();
        if (!callback) return;
        callbackStore.write({ pending: callback, recovery: null });
      } catch (error) {
        callbackStore.clear();
        callbackError.current = error;
      }
      ++operation.current;
      pendingAuth.current = null;
      store.clear();
      clearBrowserWorkspace();
      flushSync(() => {
        updateIdentity(null);
        setRecoverySession(null);
        setIsSubmitting(false);
        setAuthError(null);
        setRestoreError(null);
        setIsRestoring(true);
      });
      void restoreSavedSession();
    };
    window.addEventListener("hashchange", onAuthCallback);
    return () => {
      mounted.current = false;
      window.removeEventListener("hashchange", onAuthCallback);
    };
  }, [restoreSavedSession, store, updateIdentity]);

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
    callbackError.current = null;
    setRecoverySession(null);
    store.clear();
    clearBrowserWorkspace();
    updateIdentity(null);
    setIsSubmitting(false);
    setIsRestoring(false);
    setRestoreError(null);
    resetAuthForm("sign-in");
  }

  function resetAuthForm(mode: AuthMode) {
    setAuthMode(mode);
    setPassword("");
    setAuthError(null);
    setAuthStatus(null);
    setAuthStatusTitle("Check your email");
    if (mode === "recover") callbackStore.write({ pending: null, recovery: { stage: "request" } });
    else callbackStore.clear();
  }

  function changeAuthMode(mode: AuthMode) {
    if (isSubmitting) return;
    resetAuthForm(mode);
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
    if (authMode !== "recover") callbackStore.clear();
    let saved: Session | null = null;
    try {
      if (authMode === "recover") {
        await requestPasswordRecovery(
          email.trim(),
          `${window.location.origin}${window.location.pathname}`,
        );
        if (current())
          setAuthStatus(
            "If an account exists for this email address, you’ll receive a password recovery link. Check your inbox and spam folder.",
          );
        return;
      }
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
    clearWorkspaceLocation();
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

  function requestNewRecoveryLink() {
    const address = recoverySession?.user.email ?? email;
    discardStoredSession();
    setEmail(address);
    resetAuthForm("recover");
  }

  async function handlePasswordUpdate(nextPassword: string): Promise<void> {
    if (!recoverySession || isSubmitting || isRestoring) return;
    const generation = ++operation.current;
    const current = () => mounted.current && generation === operation.current;
    setIsSubmitting(true);
    setAuthError(null);
    try {
      const verified = await verifyRecoverySession(
        recoverySession,
        (value) => {
          if (!current()) throw new DOMException("Password recovery was replaced", "AbortError");
          return store.write(value);
        },
        recoverySession.user.id,
      );
      if (!current()) return;
      const updated = await updatePassword(verified.access_token, nextPassword);
      if (!current()) return;
      if (updated.id !== verified.user.id)
        throw new AuthCallbackError("The recovery session changed. Request a new link.", true);
      // Clear recovery state before another await or reload can replay the completed operation.
      discardStoredSession();
      setAuthStatusTitle("Password updated");
      setAuthStatus("Your password has been updated. Sign in with your new password.");
      void signOut(verified.access_token).catch(() => {
        /* Local credentials are already cleared. */
      });
    } catch (error) {
      if (!current()) return;
      if (
        error instanceof AuthCallbackError ||
        (error instanceof ApiError && [401, 403].includes(error.status ?? 0))
      ) {
        requestNewRecoveryLink();
        setAuthError("This recovery session is no longer valid. Request a new link below.");
      } else {
        setAuthError(`Could not update your password: ${getErrorMessage(error)}`);
      }
    } finally {
      if (current()) setIsSubmitting(false);
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
    authStatusTitle,
    recoverySession,
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
    handlePasswordUpdate,
    requestNewRecoveryLink,
  };
}

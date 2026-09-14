import { useEffect, useRef, useState, type SubmitEvent } from "react";
import {
  fetchAppAccount,
  fetchCompanies,
  fetchSkuAssignments,
  refreshSession,
  signIn,
  signOut,
  type AppAccount,
  type Company,
  type Session,
  type SkuAssignment,
} from "./api";
import { sessionRefreshDelayMs } from "./session";
import { getErrorMessage } from "./view-model";

export interface Identity {
  session: Session;
  account: AppAccount;
  companies: Company[];
  assignments: SkuAssignment[];
}

async function loadIdentity(session: Session): Promise<Identity> {
  const [account, companies, assignments] = await Promise.all([
    fetchAppAccount(session.access_token, session.user.id),
    fetchCompanies(session.access_token),
    fetchSkuAssignments(session.access_token),
  ]);
  return { session, account, companies, assignments };
}

export function useAuth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const operation = useRef(0);
  const session = identity?.session;

  useEffect(() => {
    if (!session || isSigningOut) return;
    let cancelled = false;
    const generation = operation.current;
    const timeout = window.setTimeout(() => {
      void refreshSession(session.refresh_token)
        .then(loadIdentity)
        .then((next) => {
          if (!cancelled && generation === operation.current) setIdentity(next);
        })
        .catch((error: unknown) => {
          if (!cancelled && generation === operation.current) {
            setIdentity(null);
            setAuthError(`Please sign in again: ${getErrorMessage(error)}`);
          }
        });
    }, sessionRefreshDelayMs(session));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [session, isSigningOut]);

  async function handleSignIn(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSigningIn || isSigningOut) return;
    const generation = ++operation.current;
    setIsSigningIn(true);
    setAuthError(null);
    setIdentity(null);
    try {
      const next = await signIn(email.trim(), password).then(loadIdentity);
      if (generation === operation.current) {
        setIdentity(next);
        setPassword("");
      }
    } catch (error) {
      if (generation === operation.current) setAuthError(getErrorMessage(error));
    } finally {
      if (generation === operation.current) setIsSigningIn(false);
    }
  }

  async function handleSignOut() {
    if (!session) return;
    ++operation.current;
    setIdentity(null);
    setPassword("");
    setAuthError(null);
    setIsSigningOut(true);
    try {
      await signOut(session.access_token);
    } catch (error) {
      setAuthError(`Could not complete sign out: ${getErrorMessage(error)}`);
    } finally {
      setIsSigningOut(false);
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
    authError,
    handleSignIn,
    handleSignOut,
  };
}

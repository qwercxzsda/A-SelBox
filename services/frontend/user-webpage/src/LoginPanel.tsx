import type { SubmitEvent } from "react";

interface LoginPanelProps {
  email: string;
  errorMessage: string | null;
  isSigningIn: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  password: string;
}

export function LoginPanel({
  email,
  errorMessage,
  isSigningIn,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  password,
}: LoginPanelProps) {
  return (
    <div className="login-shell">
      <section className="login-card">
        <p className="eyebrow">Your company workspace</p>
        <h2>Sign in to Company Finance</h2>
        <p>View your company’s transactions, marketplace costs, and current fees.</p>

        {errorMessage ? (
          <p className="error-banner" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <form className="login-form" onSubmit={onSubmit}>
          <label className="form-field">
            <span>Email</span>
            <input
              autoComplete="username"
              onChange={(event) => {
                onEmailChange(event.target.value);
              }}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input
              autoComplete="current-password"
              onChange={(event) => {
                onPasswordChange(event.target.value);
              }}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="primary-button" disabled={isSigningIn} type="submit">
            {isSigningIn ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </div>
  );
}

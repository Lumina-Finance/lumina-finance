import { createContext } from 'react';
import type {
  AuthResponse,
  ConfirmSignupPayload,
  LoginPayload,
  LoginResult,
  MfaVerifyPayload,
  SignupPayload,
  User,
} from '@/api/auth';

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  /** True while the initial silent refresh is in flight */
  loading: boolean;
  /** Why the page-load restore failed when the server could not answer, the session itself kept */
  sessionRestoreError?: unknown;
}

export interface AuthContextValue extends AuthState {
  login: (payload: LoginPayload) => Promise<LoginResult>;
  /** Exchange a second-factor challenge and code for a session */
  verifyMfa: (payload: MfaVerifyPayload) => Promise<AuthResponse>;
  /** Ask for the confirmation email, which creates no account and no session */
  signup: (payload: SignupPayload) => Promise<void>;
  /** Create the account an emailed link was sent for, answering with its session */
  confirmSignup: (payload: ConfirmSignupPayload) => Promise<AuthResponse>;
  /** Commit an auth response to state after transition animations */
  setSession: (res: AuthResponse) => void;
  /** Make an access token usable by requests without committing a session, for the signup 2FA step */
  primeAccessToken: (token: string) => void;
  /** Replace the user profile after /me updates to keep the context fresh */
  setUser: (user: User) => void;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export {
  ApiError,
  buildApiError,
  getSessionRestoreFailure,
  isRefreshAlreadyRotatedError,
  NO_EXPLANATION_MESSAGE,
  type ApiFieldError,
} from '@/api/auth/errors';

export { SESSION_KEY } from '@/api/auth/session';

export { getAccessTokenExpiresAt } from '@/api/auth/tokenAge';

export type {
  AuthResponse,
  ConfirmSignupPayload,
  ForgotPasswordPayload,
  LoginPayload,
  LoginResult,
  MfaRequiredResponse,
  MfaVerifyPayload,
  RegistrationStatus,
  ResetPasswordPayload,
  ResetPasswordResult,
  ResetPasswordVerifyPayload,
  SignupPayload,
  User,
} from '@/api/auth/types';

export {
  confirmSignup,
  fetchRegistrationStatus,
  forgotPassword,
  isMfaRequired,
  login,
  logout,
  refresh,
  resetPassword,
  restoreSession,
  signup,
  verifyMfa,
  verifyResetMfa,
} from '@/api/auth/requests';

export { useRegistrationStatus } from '@/api/auth/hooks';

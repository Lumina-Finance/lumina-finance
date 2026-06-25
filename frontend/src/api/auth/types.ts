export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string | null;
  tz: string;
  base_currency: string;
  created_at: string;
}

export interface AuthResponse {
  user: User;
  access_token: string;
  token_type: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface SignupPayload {
  email: string;
  password: string;
  first_name: string;
  last_name?: string;
  tz: string;
  base_currency: string;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ResetPasswordPayload {
  token: string;
  new_password: string;
}

export interface AuthUser {
  sub: string;
  email: string;
  fullName: string;
  accessName?: string | null;
  sessionVersion: number;
  lastLoginAt?: string | null;
  roles: string[];
  permissions: string[];
}

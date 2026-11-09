import React, { createContext, useContext, useState, useEffect } from 'react';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  title: string;
  organization: string;
  /** Present when the user has uploaded a profile photo */
  avatarUrl?: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  title?: string;
  organization?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  updateAvatar: (image: Blob) => Promise<void>;
  removeAvatar: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore existing session on load
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUser(data?.user || null))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const data = await postJson('/api/auth/login', { email, password });
    setUser(data.user);
  };

  const register = async (input: RegisterInput) => {
    const data = await postJson('/api/auth/register', input);
    setUser(data.user);
  };

  const logout = async () => {
    try {
      await postJson('/api/auth/logout');
    } finally {
      setUser(null);
    }
  };

  const requestPasswordReset = async (email: string) => {
    await postJson('/api/auth/forgot-password', { email });
  };

  // Sets the new password and signs in with it
  const resetPassword = async (token: string, password: string) => {
    const data = await postJson('/api/auth/reset-password', { token, password });
    setUser(data.user);
  };

  const updateAvatar = async (image: Blob) => {
    const res = await fetch('/api/auth/avatar', {
      method: 'PUT',
      headers: { 'Content-Type': image.type || 'application/octet-stream' },
      credentials: 'same-origin',
      body: image,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The photo could not be saved.');
    setUser(data.user);
  };

  const removeAvatar = async () => {
    const res = await fetch('/api/auth/avatar', { method: 'DELETE', credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The photo could not be removed.');
    setUser(data.user);
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, register, logout, requestPasswordReset, resetPassword, updateAvatar, removeAvatar }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

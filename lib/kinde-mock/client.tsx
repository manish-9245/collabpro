"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface KindeUser {
  id: string;
  email: string;
  given_name: string;
  picture?: string;
}

const AuthContext = createContext<{
  user: KindeUser | null;
  isLoading: boolean;
} | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<KindeUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setUser({
              id: data.user.id,
              email: data.user.email,
              given_name: data.user.name,
              picture: data.user.image || `https://api.dicebear.com/7.x/initials/svg?seed=${data.user.name}`,
            });
          }
        }
      } catch (err) {
        console.error("Auth check failed:", err);
      } finally {
        setIsLoading(false);
      }
    }
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useKindeBrowserClient() {
  const context = useContext(AuthContext);
  if (!context) {
    return { user: null, isLoading: false, isAuthenticated: false };
  }
  return {
    user: context.user,
    isLoading: context.isLoading,
    isAuthenticated: !!context.user,
  };
}

export function LoginLink({ children, postLoginRedirectURL }: { children: React.ReactNode; postLoginRedirectURL?: string }) {
  const url = postLoginRedirectURL ? `/login?post_login_redirect_url=${encodeURIComponent(postLoginRedirectURL)}` : '/login';
  return (
    <a href={url} style={{ display: 'inline-block', width: '100%', height: '100%' }}>
      {children}
    </a>
  );
}

export function RegisterLink({ children }: { children: React.ReactNode }) {
  return (
    <a href="/register" style={{ display: 'inline-block', width: '100%', height: '100%' }}>
      {children}
    </a>
  );
}

export function LogoutLink({ children }: { children: React.ReactNode }) {
  return (
    <a href="/api/auth/logout" style={{ display: 'inline-block', width: '100%', height: '100%' }}>
      {children}
    </a>
  );
}

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('pt_token'));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSlotModalOpen, setIsSlotModalOpen] = useState(false);

  const openSlotModal = useCallback(() => setIsSlotModalOpen(true), []);
  const closeSlotModal = useCallback(() => setIsSlotModalOpen(false), []);

  const updateUser = useCallback((updater) => {
    setUser((prev) => {
      if (typeof updater === 'function') {
        return updater(prev);
      }
      return prev ? { ...prev, ...updater } : updater;
    });
  }, []);

  const refreshUser = useCallback(async () => {
    const activeToken = localStorage.getItem('pt_token');
    if (!activeToken) {
      setUser(null);
      setToken(null);
      setLoading(false);
      return null;
    }
    try {
      const me = await authApi.me();
      setUser(me);
      return me;
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        localStorage.removeItem('pt_token');
        setToken(null);
        setUser(null);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async ({ email, password }) => {
    const data = await authApi.login({ email, password });
    if (data?.access_token) {
      localStorage.setItem('pt_token', data.access_token);
      setToken(data.access_token);
    }
    if (data?.user) {
      setUser(data.user);
    } else {
      await refreshUser();
    }
    return data;
  }, [refreshUser]);

  const register = useCallback(async ({ email, password }) => {
    const data = await authApi.register({ email, password });
    if (data?.access_token) {
      localStorage.setItem('pt_token', data.access_token);
      setToken(data.access_token);
    }
    if (data?.user) {
      setUser(data.user);
    } else {
      await refreshUser();
    }
    return data;
  }, [refreshUser]);

  const logout = useCallback(() => {
    localStorage.removeItem('pt_token');
    setToken(null);
    setUser(null);
    setIsSlotModalOpen(false);
  }, []);

  const value = {
    user,
    token,
    loading,
    login,
    register,
    logout,
    refreshUser,
    updateUser,
    isSlotModalOpen,
    openSlotModal,
    closeSlotModal,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

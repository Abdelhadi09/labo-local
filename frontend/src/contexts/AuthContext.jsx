import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, TOKEN_KEY, REFRESH_TOKEN_KEY } from '../services/api';

const AuthContext = createContext(null);

const saveSession = (accessToken, refreshToken, user) => {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem('user', JSON.stringify(user));
};

const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem('token');
  localStorage.removeItem('user');
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token =
      localStorage.getItem(TOKEN_KEY) ??
      localStorage.getItem('token');

    if (!token) {
      setLoading(false);
      return;
    }

    authAPI
      .me()
      .then((res) => {
        setUser(res.data);
      })
      .catch(() => {
        clearSession();
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const workerLogin = async (credentials) => {
    const res = await authAPI.workerLogin(credentials);

    const {
      accessToken,
      refreshToken,
      user: backendUser,
    } = res.data;

    saveSession(accessToken, refreshToken, backendUser);

    setUser(backendUser);

    return backendUser;
  };

  const signUpEmail = async (email, password) => {
    const res = await authAPI.register({
      email,
      password,
    });

    return res.data;
  };

  const signInEmail = async (email, password) => {
    const res = await authAPI.login({
      email,
      password,
    });

    const {
      accessToken,
      refreshToken,
      user: backendUser,
    } = res.data;

    saveSession(accessToken, refreshToken, backendUser);

    setUser(backendUser);

    return backendUser;
  };

  const forgotPassword = async (email) => {
    const res = await authAPI.forgotPassword(email);
    return res.data;
  };

  const resetPassword = async (token, password) => {
    const res = await authAPI.resetPassword(token, password);
    return res.data;
  };

  const signInWithGoogle = () => {
    window.location.href = `${
      import.meta.env.VITE_API_URL || '/api'
    }/auth/google`;
  };

  const exchangeOAuthCode = async (code) => {
    const res = await authAPI.oauthExchange(code);

    const {
      accessToken,
      refreshToken,
      user: backendUser,
    } = res.data;

    saveSession(accessToken, refreshToken, backendUser);

    setUser(backendUser);

    return backendUser;
  };

  const logout = async ({ allDevices = false } = {}) => {
    const refreshToken = localStorage.getItem(
      REFRESH_TOKEN_KEY
    );

    try {
      await authAPI.logout(refreshToken, allDevices);
    } catch {}

    clearSession();

    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        workerLogin,
        signUpEmail,
        signInEmail,
        forgotPassword,
        resetPassword,
        signInWithGoogle,
        exchangeOAuthCode,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error(
      'useAuth must be used within AuthProvider'
    );
  }

  return ctx;
};
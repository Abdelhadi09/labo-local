import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import React, { Suspense, lazy } from 'react';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const OAuthCallback = lazy(() => import('./pages/OAuthCallback'));
const ClientDashboard = lazy(() => import('./pages/client/ClientDashboard'));
const WorkerDashboard = lazy(() => import('./pages/worker/WorkerDashboard'));
const LandingPage = lazy(() => import('./pages/LandingPage'));

import ErrorBoundary from './components/ErrorBoundry.jsx';
import PageLoader from './components/PageLoader';

const ProtectedRoute = ({ children, role }) => {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  // Admins share the worker dashboard (with extra "all branches" controls),
  // so the "worker" route must also accept role === 'admin'.
  const allowed = role === 'worker'
    ? (user.role === 'worker' || user.role === 'admin')
    : !role || user.role === role;
  if (!allowed) return <Navigate to="/" replace />;

  return children;
};

const RootRedirect = () => {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader />;

  if (!user) {
    return <LandingPage />;
  }

  return (user.role === 'worker' || user.role === 'admin')
    ? <Navigate to="/worker" replace />
    : <Navigate to="/client" replace />;
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<RootRedirect />} />

            <Route
              path="/login"
              element={<LoginPage />}
            />

            <Route
              path="/register"
              element={<RegisterPage />}
            />
            <Route
  path="/verify-email"
  element={<VerifyEmailPage />}
/>

            <Route
              path="/forgot-password"
              element={<ForgotPasswordPage />}
            />

            <Route
              path="/reset-password"
              element={<ResetPasswordPage />}
            />

            {/* Google OAuth callback */}
            <Route
              path="/oauth/callback"
              element={<OAuthCallback />}
            />

            <Route
              path="/client/*"
              element={
                <ProtectedRoute role="client">
                  <ErrorBoundary>
                    <ClientDashboard />
                  </ErrorBoundary>
                </ProtectedRoute>
              }
            />

            <Route
              path="/worker/*"
              element={
                <ProtectedRoute role="worker">
                  <ErrorBoundary>
                    <WorkerDashboard />
                  </ErrorBoundary>
                </ProtectedRoute>
              }
            />

            <Route
              path="*"
              element={<Navigate to="/" replace />}
            />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
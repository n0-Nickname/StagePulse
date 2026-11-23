import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
import Navbar from './components/Navbar.jsx';
import LandingPage from './pages/LandingPage.jsx';
import PracticePage from './pages/PracticePage.jsx';

const AuthPage = lazy(() => import('./pages/AuthPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const SlotMachineModal = lazy(() => import('./components/SlotMachineModal.jsx'));

function PageSpinner() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-white/[0.12] border-t-[#FF6363] animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <PageSpinner />;
  }

  if (!user) {
    return <Navigate to="/auth?mode=login" replace />;
  }

  return children;
}

function AppShell() {
  const { user, loading, isSlotModalOpen, closeSlotModal } = useAuth();

  return (
    <div
      data-testid="app-shell"
      className="min-h-screen overflow-x-hidden bg-[#07080A] text-[#F4F5F7] flex flex-col"
    >
      <Navbar />
      <main className="flex-1">
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route
              path="/auth"
              element={
                !loading && user ? <Navigate to="/practice" replace /> : <AuthPage />
              }
            />
            <Route
              path="/practice"
              element={
                <ProtectedRoute>
                  <PracticePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      {isSlotModalOpen && (
        <Suspense fallback={null}>
          <SlotMachineModal isOpen={isSlotModalOpen} onClose={closeSlotModal} />
        </Suspense>
      )}
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </LanguageProvider>
  );
}

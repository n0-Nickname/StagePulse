import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
import Navbar from './components/Navbar.jsx';
import SlotMachineModal from './components/SlotMachineModal.jsx';
import AuthPage from './pages/AuthPage.jsx';
import PracticePage from './pages/PracticePage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-[#3A3834] border-t-[#D97757] animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return children;
}

function AppShell() {
  const { user, loading, isSlotModalOpen, closeSlotModal } = useAuth();

  return (
    <div className="min-h-screen bg-[#1E1D1B] text-[#EAE6DF] flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route
            path="/auth"
            element={
              !loading && user ? <Navigate to="/" replace /> : <AuthPage />
            }
          />
          <Route
            path="/"
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
      </main>
      <SlotMachineModal isOpen={isSlotModalOpen} onClose={closeSlotModal} />
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

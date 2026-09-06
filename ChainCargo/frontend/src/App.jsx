import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import WalletGate from './components/WalletGate';
import Home from './pages/Home';
import Register from './pages/Register';
import WalletAccess from './pages/WalletAccess';
import Dashboard from './pages/Dashboard';
import CreateAgreement from './pages/CreateAgreement';
import AgreementDetail from './pages/AgreementDetail';
import History from './pages/History';
import Profile from './pages/Profile';
import AccountPermissionDialog from './components/AccountPermissionDialog';
import NoticeToasts from './components/NoticeToasts';
import AgreementRejectionNotice from './components/AgreementRejectionNotice';
import { NotificationProvider } from './context/NotificationContext';
import './App.css';
import './workspace.css';

function AppLayout() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => {
    if (!navigationOpen) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const navigation = document.getElementById('workspace-navigation');
    document.body.style.overflow = 'hidden';
    navigation?.querySelector('a')?.focus();
    const close = (event) => {
      if (event.key === 'Escape') setNavigationOpen(false);
      if (event.key !== 'Tab') return;
      const controls = [...navigation.querySelectorAll('a, button')]
        .filter((element) => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [navigationOpen]);
  return (
    <div className={`app-shell ${navigationOpen ? 'navigation-open' : ''}`}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <AgreementRejectionNotice />
      {navigationOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setNavigationOpen(false)} type="button" />}
      <Sidebar onClose={() => setNavigationOpen(false)} />
      <div className="workspace-body" inert={navigationOpen}>
        <Navbar navigationOpen={navigationOpen} onOpenNavigation={() => setNavigationOpen(true)} />
        <main className="main-content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="workspace-footer"><span>CargoSeal <span className="footer-dot">·</span> Built on trust. Verified on-chain.</span><span>Ethereum logistics workspace</span></footer>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <NotificationProvider>
      <NoticeToasts />
      <AccountPermissionDialog />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<WalletAccess />} />
          <Route path="/register" element={<Register />} />
          <Route element={<WalletGate />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/create-agreement" element={<CreateAgreement />} />
            <Route path="/agreement/:id" element={<AgreementDetail />} />
            <Route path="/history" element={<History />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
      </NotificationProvider>
    </BrowserRouter>
  );
}

export default App;

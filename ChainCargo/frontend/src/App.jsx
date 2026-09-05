import { BrowserRouter, Navigate, Routes, Route, Outlet } from 'react-router-dom';
import Navbar from './components/Navbar';
import WalletGate from './components/WalletGate';
import Home from './pages/Home';
import Register from './pages/Register';
import WalletAccess from './pages/WalletAccess';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import CreateAgreement from './pages/CreateAgreement';
import AgreementDetail from './pages/AgreementDetail';
import History from './pages/History';
import Profile from './pages/Profile';
import AccountPermissionDialog from './components/AccountPermissionDialog';
import NoticeToasts from './components/NoticeToasts';
import AgreementRejectionNotice from './components/AgreementRejectionNotice';
import './App.css';

function AppLayout() {
  return (
    <div className="app-shell">
      <Navbar />
      <AgreementRejectionNotice />
      <div className="app-content">
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <NoticeToasts />
      <AccountPermissionDialog />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/setup" element={<Setup />} />
          <Route element={<WalletGate />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/create-agreement" element={<CreateAgreement />} />
            <Route path="/agreement/:id" element={<AgreementDetail />} />
            <Route path="/history" element={<History />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
        </Route>
        <Route path="/login" element={<WalletAccess />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

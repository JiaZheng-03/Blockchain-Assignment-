import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import WalletButton from './WalletButton';
import NotificationButton from './NotificationButton';
import Icon from './Icon';
import { useContract } from '../context/ContractContext';
import { useWallet } from '../context/WalletContext';
import { useProfile } from '../hooks/useProfile';

const pages = [
  { to: '/', name: 'Overview', detail: 'How your logistics workspace works', icon: 'globe' },
  { to: '/dashboard', name: 'Dashboard', detail: 'Agreements, milestones and escrow', icon: 'grid' },
  { to: '/history', name: 'Transactions', detail: 'Agreement history and payments', icon: 'arrows' },
  { to: '/create-agreement', name: 'New agreement', detail: 'Create and fund a shipment', icon: 'plus' },
  { to: '/profile', name: 'Wallet & profile', detail: 'Your identity, role and balance', icon: 'wallet' },
  { to: '/setup', name: 'Network setup', detail: 'Connection and contract readiness', icon: 'settings' },
  { to: '/register', name: 'Wallet registration', detail: 'Register your role on-chain', icon: 'user' },
  { to: '/login', name: 'Wallet access', detail: 'Connect and sign in with MetaMask', icon: 'lock' },
];

export default function Navbar({ onOpenNavigation, navigationOpen }) {
  const location = useLocation();
  const navigate = useNavigate();
  const dialogRef = useRef(null);
  const [query, setQuery] = useState('');
  const { account, isConnected, isAuthenticated } = useWallet();
  const { isCarrier, isArbitrator } = useProfile();
  const { expectedNetworkName, deploymentStatus, address, blockExplorerUrl } = useContract();
  const currentPage = pages.find((page) => page.to === location.pathname)?.name || 'Agreement details';
  const filteredPages = pages.filter((page) => (
    !(isAuthenticated && (page.to === '/setup' || page.to === '/register')) &&
    !(page.to === '/create-agreement' && (isCarrier || isArbitrator)) &&
    `${page.name} ${page.detail}`.toLowerCase().includes(query.toLowerCase())
  ));
  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        dialogRef.current?.showModal();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);
  const openPage = (to) => {
    dialogRef.current.close();
    setQuery('');
    navigate(to);
  };
  return (
    <>
      <header className="navbar workspace-topbar">
        <div className="topbar-leading">
          <button className="icon-button mobile-nav-toggle" onClick={onOpenNavigation} aria-label="Open navigation" aria-expanded={navigationOpen} aria-controls="workspace-navigation" type="button"><Icon name="menu" /></button>
          <div className="breadcrumbs"><Link to="/" aria-label="Overview"><Icon name="grid" size={16} /></Link><span>Workspace</span><Icon name="chevron" size={13} /><strong>{currentPage}</strong></div>
          <button className="command-trigger" onClick={() => dialogRef.current.showModal()} type="button"><Icon name="search" size={18} /><span>Search page, action...</span><kbd>Ctrl K</kbd></button>
        </div>
        <div className="topbar-actions"><NotificationButton /><WalletButton /></div>
      </header>
      <div className="workspace-status" aria-label="Workspace status">
        <span><span className={`status-dot ${deploymentStatus === 'ready' ? '' : 'muted'}`} /><strong>{expectedNetworkName}</strong></span>
        <span><Icon name="lock" size={14} />Milestone escrow <strong>2 checkpoints</strong></span>
        <span><Icon name="file" size={14} />Evidence <strong>File hash verification</strong></span>
        <span className="connection-status">{isConnected && account ? 'Wallet connected' : 'Wallet not connected'}</span>
        {address && blockExplorerUrl && <a href={`${blockExplorerUrl}/address/${address}`} target="_blank" rel="noreferrer">View contract <Icon name="external" size={13} /></a>}
      </div>
      <dialog className="command-dialog" ref={dialogRef} aria-labelledby="command-title" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <form onSubmit={(event) => { event.preventDefault(); if (filteredPages[0]) openPage(filteredPages[0].to); }}>
          <div className="command-input-row"><Icon name="search" /><label className="sr-only" htmlFor="command-input" id="command-title">Search pages and actions</label><input id="command-input" placeholder="Where would you like to go?" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" /><button className="icon-button" aria-label="Close search" type="button" onClick={() => dialogRef.current.close()}><Icon name="close" /></button></div>
          <div className="command-results">
            <span className="nav-group-label">PAGES & ACTIONS</span>
            {filteredPages.map((page) => <button key={page.to} type="button" onClick={() => openPage(page.to)}><Icon name={page.icon} /><span><strong>{page.name}</strong><small>{page.detail}</small></span><Icon name="arrow" size={16} /></button>)}
            {!filteredPages.length && <p className="command-empty">No pages match “{query}”. Try “wallet” or “agreement”.</p>}
          </div>
          <div className="command-footer"><span>Enter to open the first result</span><span>Esc to close</span></div>
        </form>
      </dialog>
    </>
  );
}

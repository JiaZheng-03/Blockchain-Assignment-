import { Link, useLocation } from 'react-router-dom';
import WalletButton from './WalletButton';
import NotificationButton from './NotificationButton';
import Icon from './Icon';
import { useContract } from '../context/ContractContext';
import { useWallet } from '../context/WalletContext';

const pages = [
  { to: '/', name: 'Overview' },
  { to: '/dashboard', name: 'Dashboard' },
  { to: '/history', name: 'Transactions' },
  { to: '/create-agreement', name: 'New agreement' },
  { to: '/profile', name: 'Wallet & profile' },
  { to: '/register', name: 'Wallet registration' },
  { to: '/login', name: 'Wallet access' },
];

export default function Navbar({ onOpenNavigation, navigationOpen }) {
  const location = useLocation();
  const { account, isConnected } = useWallet();
  const { expectedNetworkName, deploymentStatus, address, blockExplorerUrl } = useContract();
  const currentPage = pages.find((page) => page.to === location.pathname)?.name || 'Agreement details';

  return (
    <>
      <header className="navbar workspace-topbar">
        <div className="topbar-leading">
          <button className="icon-button mobile-nav-toggle" onClick={onOpenNavigation} aria-label="Open navigation" aria-expanded={navigationOpen} aria-controls="workspace-navigation" type="button"><Icon name="menu" /></button>
          <div className="breadcrumbs"><Link to="/" aria-label="Overview"><Icon name="grid" size={16} /></Link><span>Workspace</span><Icon name="chevron" size={13} /><strong>{currentPage}</strong></div>
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
    </>
  );
}

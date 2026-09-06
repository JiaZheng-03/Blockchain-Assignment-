import { Link, NavLink } from 'react-router-dom';
import { useContract } from '../context/ContractContext';
import { useWallet } from '../context/WalletContext';
import { useProfile } from '../hooks/useProfile';
import Icon from './Icon';

export default function Sidebar({ onClose }) {
  const { account, formatAddress } = useWallet();
  const { expectedNetworkName, deploymentStatus } = useContract();
  const { isShipper, isCarrier, isArbitrator, profile, roleLabel } = useProfile();
  const groups = [
    { label: 'Workspace', items: [
      ['/', 'Overview', 'globe'],
      ['/dashboard', isArbitrator ? 'Arbitration' : 'Dashboard', 'grid'],
      ['/history', isArbitrator ? 'Dispute history' : 'Transactions', 'arrows'],
      ...(!isCarrier && !isArbitrator ? [['/create-agreement', 'New agreement', 'plus']] : []),
    ] },
    { label: 'Account', items: [
      ['/profile', 'Wallet & profile', 'wallet'],
    ] },
  ];
  return (
    <aside className="sidebar" id="workspace-navigation">
      <div className="sidebar-brand-row">
        <Link to="/" className="brand sidebar-brand" onClick={onClose}>
          <span className="brand-mark"><img src="/favicon.svg" alt="" width="41" height="41" aria-hidden="true" /></span>
          <span>CargoSeal<small>LOGISTICS, CONNECTED</small></span>
        </Link>
        <button className="icon-button mobile-nav-close" aria-label="Close navigation" onClick={onClose} type="button"><Icon name="close" /></button>
      </div>
      <nav aria-label="Main navigation" className="sidebar-navigation">
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.items.map(([to, label, icon]) => (
              <NavLink end={to === '/'} key={to} to={to} onClick={onClose}>
                <Icon name={icon} /><span>{label}</span>
                {to === '/create-agreement' && isShipper && <span className="nav-mini-label">NEW</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-network"><span className={`status-dot ${deploymentStatus === 'ready' ? '' : 'muted'}`} /><span>{expectedNetworkName}</span><small>TESTNET</small></div>
        <Link className="sidebar-account" to={account ? '/profile' : '/login'} onClick={onClose}>
          <span className="account-avatar">{profile?.name?.slice(0, 2).toUpperCase() || <Icon name="user" size={18} />}</span>
          <span><strong>{profile?.name || (account ? formatAddress(account) : 'Your workspace')}</strong><small>{account ? roleLabel : 'Connect your wallet'}</small></span>
          <Icon name="chevron" size={16} />
        </Link>
      </div>
    </aside>
  );
}

import { Link, NavLink } from 'react-router-dom';
import WalletButton from './WalletButton';
import NotificationButton from './NotificationButton';
import { useWallet } from '../context/WalletContext';
import { useProfile } from '../hooks/useProfile';
import { useWalletBalance } from '../hooks/useWalletBalance';

function Navbar() {
  const { account } = useWallet();
  const { isArbitrator, profile, roleLabel } = useProfile();
  const { displayBalance } = useWalletBalance();

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        ChainCargo
      </Link>
      <nav className="nav-links">
        <NavLink to="/">Home</NavLink>
        {account && (
          <NavLink className="navbar-profile" to="/profile">
            <span>{isArbitrator ? 'Contract deployer' : profile?.name || 'Profile'}</span>
            <small>{roleLabel}</small>
          </NavLink>
        )}
        {account && (
          <span className="navbar-balance">
            <small>Balance</small>
            <strong>{displayBalance}</strong>
          </span>
        )}
        <NotificationButton />
        <WalletButton />
      </nav>
    </header>
  );
}

export default Navbar;

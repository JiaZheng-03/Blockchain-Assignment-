import { Link, NavLink } from 'react-router-dom';
import WalletButton from './WalletButton';
import { useWallet } from '../context/WalletContext';
import { useProfile } from '../hooks/useProfile';

function Navbar() {
  const { account } = useWallet();
  const { hasAppAccess, isArbitrator, isShipper, profile, roleLabel } = useProfile();

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        ChainCargo
      </Link>
      <nav className="nav-links">
        <NavLink to="/">Home</NavLink>
        <NavLink to="/setup">Setup</NavLink>
        {hasAppAccess && <NavLink to="/dashboard">{isArbitrator ? 'Arbitration' : 'Dashboard'}</NavLink>}
        {isShipper && <NavLink to="/create-agreement">Create Agreement</NavLink>}
        {account && !hasAppAccess && <NavLink to="/register">Register</NavLink>}
        {account ? (
          <span className={`badge role-badge role-${roleLabel.toLowerCase()}`}>
            {isArbitrator
              ? `Arbitrator · ${account.slice(0, 6)}...${account.slice(-4)}`
              : profile
                ? `${profile.roleLabel} · ${profile.name}`
                : `${account.slice(0, 6)}...${account.slice(-4)}`}
          </span>
        ) : null}
        <WalletButton />
      </nav>
    </header>
  );
}

export default Navbar;

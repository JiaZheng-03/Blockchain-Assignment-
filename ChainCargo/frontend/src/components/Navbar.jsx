import { Link, NavLink } from 'react-router-dom';
import WalletButton from './WalletButton';
import { useWallet } from '../context/WalletContext';

function Navbar() {
  const { account } = useWallet();

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        ChainCargo
      </Link>
      <nav className="nav-links">
        <NavLink to="/">Home</NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/create-agreement">Create</NavLink>
        <NavLink to="/login">Login</NavLink>
        {account ? <span className="badge">{account.slice(0, 6)}...{account.slice(-4)}</span> : null}
        <WalletButton />
      </nav>
    </header>
  );
}

export default Navbar;

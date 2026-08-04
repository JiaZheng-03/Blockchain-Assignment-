import { NavLink } from 'react-router-dom';
import { useProfile } from '../hooks/useProfile';

function Sidebar() {
  const { hasAppAccess, isArbitrator, isShipper } = useProfile();
  const links = [
    { to: '/setup', label: 'Setup & Demo Flow' },
    ...(hasAppAccess ? [{ to: '/dashboard', label: isArbitrator ? 'Arbitration' : 'Dashboard' }] : []),
    ...(hasAppAccess && isShipper ? [{ to: '/create-agreement', label: 'Create Agreement' }] : []),
    ...(hasAppAccess ? [
      { to: '/history', label: isArbitrator ? 'Dispute History' : 'History' },
      { to: '/profile', label: isArbitrator ? 'Arbitrator Account' : 'Profile' },
    ] : []),
  ];

  return (
    <aside className="sidebar">
      <ul>
        {links.map((link) => (
          <li key={link.to}>
            <NavLink to={link.to}>{link.label}</NavLink>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default Sidebar;

import { NavLink } from 'react-router-dom';
import { useProfile } from '../hooks/useProfile';

function Sidebar() {
  const { isRegistered, isShipper } = useProfile();
  const links = [
    { to: '/setup', label: 'Setup & Demo Flow' },
    ...(isRegistered ? [{ to: '/dashboard', label: 'Dashboard' }] : []),
    ...(isRegistered && isShipper ? [{ to: '/create-agreement', label: 'Create Agreement' }] : []),
    ...(isRegistered ? [
      { to: '/history', label: 'History' },
      { to: '/profile', label: 'Profile' },
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

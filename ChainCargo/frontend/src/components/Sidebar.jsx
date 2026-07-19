import { NavLink } from 'react-router-dom';

function Sidebar() {
  const links = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/create-agreement', label: 'Create Agreement' },
    { to: '/history', label: 'History' },
    { to: '/profile', label: 'Profile' },
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

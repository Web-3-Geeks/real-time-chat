import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function DashboardLayout({ children }) {
  const { user, logout } = useAuth();
  const initials = user?.name
    ? user.name
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '?';

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-nav-active dark:bg-nav-active-dark text-nav-active-ink dark:text-nav-active-ink-dark'
        : 'text-muted hover:bg-page dark:hover:bg-page-dark'
    }`;

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="flex md:flex-col items-center md:items-stretch gap-2 md:gap-0 bg-surface dark:bg-surface-dark border-b md:border-b-0 md:border-r border-line dark:border-line-dark px-4 py-3 md:w-60 md:flex-shrink-0 md:p-5 overflow-x-auto">
        <div className="hidden md:flex items-center gap-2.5 px-2 pb-5 font-bold text-ink dark:text-ink-dark">
          <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center text-sm font-bold">
            RC
          </div>
          RealChat
        </div>

        <nav className="flex md:flex-col gap-1 md:flex-1">
          <NavLink to="/dashboard" className={navLinkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/chat" className={navLinkClass}>
            Chats
          </NavLink>
          <NavLink to="/profile" className={navLinkClass}>
            Profile
          </NavLink>
        </nav>

        <div className="flex items-center gap-2.5 md:border-t md:border-line md:dark:border-line-dark md:pt-3 md:mt-3 md:ml-0 ml-3 pl-3 border-l md:border-l-0 border-line dark:border-line-dark">
          <div className="w-9 h-9 rounded-full bg-nav-active dark:bg-nav-active-dark text-nav-active-ink dark:text-nav-active-ink-dark flex items-center justify-center text-xs font-semibold flex-shrink-0">
            {initials}
          </div>
          <div className="hidden md:block min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink dark:text-ink-dark truncate">
              {user?.name}
            </div>
            <div className="text-xs text-muted truncate">{user?.email}</div>
          </div>
          <button
            onClick={logout}
            aria-label="Log out"
            className="p-1.5 rounded-lg text-muted hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-5 md:p-8 bg-page dark:bg-page-dark">{children}</main>
    </div>
  );
}

export default DashboardLayout;

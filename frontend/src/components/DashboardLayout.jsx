import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Avatar, { BrandMark } from './Avatar';
import ChatIcon from './ChatIcon';
import ThemeToggle from './ThemeToggle';

const iconButtonClass = ({ isActive } = {}) =>
  `relative w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
    isActive
      ? 'bg-linear-to-br from-accent-light to-accent text-white shadow-md shadow-accent/30'
      : 'text-ink dark:text-ink-dark hover:bg-nav-active dark:hover:bg-nav-active-dark'
  }`;

/**
 * App shell: a floating header card on top, page content below.
 *
 * Optional props let a page plug into the header:
 *  - `search` / `onSearchChange`: make the header search box drive the page's
 *    own filter (the Chat page). Without them, submitting the box opens /chat
 *    pre-filtered with the query.
 *  - `unreadCount`: shows the red dot on the bell.
 *  - `onNotificationsClick`: what the bell does; defaults to opening the
 *    Unread tab on /chat.
 *  - `fullHeight`: lock the shell to the viewport so the page can manage its
 *    own inner scrolling (the Chat page).
 */
function DashboardLayout({
  children,
  fullHeight = false,
  search,
  onSearchChange,
  unreadCount = 0,
  onNotificationsClick,
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [localSearch, setLocalSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const isControlled = typeof onSearchChange === 'function';
  const searchValue = isControlled ? search : localSearch;

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!isControlled) navigate('/chat', { state: { search: localSearch } });
  };

  const handleBell = () => {
    if (onNotificationsClick) onNotificationsClick();
    else navigate('/chat', { state: { tab: 'unread' } });
  };

  const menuItemClass =
    'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors';

  return (
    <div
      className={`flex flex-col gap-3 md:gap-4 p-2 sm:p-3 md:p-5 bg-page dark:bg-page-dark ${
        fullHeight ? 'h-svh' : 'min-h-svh'
      }`}
    >
      <header className="flex items-center gap-3 bg-surface dark:bg-surface-dark rounded-2xl shadow-sm px-4 md:px-5 py-2.5 flex-shrink-0">
        <Link
          to="/dashboard"
          className="flex items-center gap-2.5 text-lg font-bold text-ink dark:text-ink-dark mr-auto"
        >
          <BrandMark />
          RealChat
        </Link>

        <form onSubmit={handleSearchSubmit} className="hidden sm:block relative w-56 lg:w-72">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink dark:text-ink-dark"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={searchValue}
            onChange={(e) =>
              isControlled ? onSearchChange(e.target.value) : setLocalSearch(e.target.value)
            }
            placeholder="Search..."
            aria-label="Search conversations and people"
            className="w-full pl-10 pr-4 py-2 rounded-full bg-nav-active dark:bg-nav-active-dark text-ink dark:text-ink-dark text-sm outline-none border border-transparent focus:border-accent/50 transition-colors placeholder:text-muted"
          />
        </form>

        <div className="flex items-center gap-1">
          <span className="mr-1.5">
            <ThemeToggle />
          </span>
          <button
            type="button"
            onClick={handleBell}
            aria-label={unreadCount > 0 ? `${unreadCount} unread messages` : 'Notifications'}
            title="Unread messages"
            className={iconButtonClass()}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-danger ring-2 ring-surface dark:ring-surface-dark" />
            )}
          </button>

          <NavLink to="/chat" aria-label="Chats" title="Chats" className={iconButtonClass}>
            <ChatIcon />
          </NavLink>

          <div ref={menuRef} className="relative ml-1">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
              className="relative flex items-center rounded-full ring-2 ring-transparent hover:ring-accent/30 transition"
            >
              <Avatar name={user?.name} src={user?.avatar} size="w-9 h-9" textSize="text-xs" />
              <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-surface dark:bg-surface-dark shadow flex items-center justify-center text-ink dark:text-ink-dark">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-12 z-40 w-60 bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-2xl shadow-xl p-2"
              >
                <div className="flex items-center gap-2.5 px-2 py-2 mb-1 border-b border-line dark:border-line-dark">
                  <Avatar name={user?.name} src={user?.avatar} size="w-9 h-9" textSize="text-xs" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink dark:text-ink-dark truncate">{user?.name}</p>
                    <p className="text-xs text-muted truncate">{user?.email}</p>
                  </div>
                </div>
                {[
                  { to: '/dashboard', label: 'Dashboard' },
                  { to: '/chat', label: 'Chats' },
                  { to: '/profile', label: 'Profile' },
                ].map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `${menuItemClass} ${
                        isActive
                          ? 'bg-accent-soft dark:bg-accent-soft-dark text-accent font-medium'
                          : 'text-ink dark:text-ink-dark hover:bg-nav-active dark:hover:bg-nav-active-dark'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={logout}
                  className={`${menuItemClass} mt-1 text-danger hover:bg-danger-soft`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={`flex-1 min-w-0 ${fullHeight ? 'min-h-0' : 'px-1 md:px-2 py-2'}`}>{children}</main>
    </div>
  );
}

export default DashboardLayout;

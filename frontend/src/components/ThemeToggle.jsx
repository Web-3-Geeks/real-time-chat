import { useState } from 'react';

const STORAGE_KEY = 'theme';

// The initial class is applied by the inline script in index.html (before
// React loads, so there's no light-mode flash) — read it back from the DOM.
const isDarkNow = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

/** Day / night pill switch. The choice is remembered in localStorage. */
function ThemeToggle() {
  const [dark, setDark] = useState(isDarkNow);

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // Storage blocked — the theme still applies for this page view.
    }
    setDark(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? 'Switch to day mode' : 'Switch to night mode'}
      title={dark ? 'Day mode' : 'Night mode'}
      onClick={toggle}
      className={`relative w-[3.75rem] h-8 rounded-full flex-shrink-0 transition-colors duration-300 border ${
        dark ? 'bg-[#23263a] border-[#34385a]' : 'bg-accent-soft border-accent/20'
      }`}
    >
      {/* Faint glyphs on the track show the "other" mode. */}
      <span className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className={dark ? 'text-amber-300/70' : 'opacity-0'} aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="currentColor" />
        </svg>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className={dark ? 'opacity-0' : 'text-accent/50'} aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      </span>

      <span
        className={`absolute top-0.5 left-0.5 w-[1.625rem] h-[1.625rem] rounded-full flex items-center justify-center shadow-md transition-transform duration-300 ${
          dark
            ? 'translate-x-7 bg-[#3b4170] text-amber-200'
            : 'translate-x-0 bg-linear-to-br from-accent-light to-accent text-white'
        }`}
      >
        {dark ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="4" fill="currentColor" />
            <path
              d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
}

export default ThemeToggle;

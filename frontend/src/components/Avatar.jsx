import { useState } from 'react';

// Soft, warm palette for initials avatars — picked deterministically from the
// name so the same person always gets the same colour across the app.
const PALETTE = [
  'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
];

const colorFor = (name = '') => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
};

const initialsFor = (name) =>
  name
    ? name
        .split(' ')
        .filter(Boolean)
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '?';

/**
 * `online` is tri-state: undefined hides the presence dot entirely (groups,
 * self), true/false shows a green/grey dot.
 */
function Avatar({ name, src, size = 'w-10 h-10', textSize = 'text-sm', online, group = false }) {
  const [broken, setBroken] = useState(false);
  const showImage = src && !broken;

  return (
    <span className={`relative inline-flex flex-shrink-0 ${size}`}>
      {showImage ? (
        <img
          src={src}
          alt=""
          onError={() => setBroken(true)}
          className="w-full h-full rounded-full object-cover"
        />
      ) : (
        <span
          className={`w-full h-full rounded-full flex items-center justify-center font-semibold ${textSize} ${
            group ? 'bg-accent-soft text-accent dark:bg-accent-soft-dark' : colorFor(name)
          }`}
          aria-hidden="true"
        >
          {initialsFor(name)}
        </span>
      )}
      {online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-surface dark:ring-surface-dark ${
            online ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-500'
          }`}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

export function BrandMark({ size = 'w-8 h-8 text-base' }) {
  return (
    <span
      className={`${size} rounded-lg bg-accent-soft dark:bg-accent-soft-dark border border-accent/30 text-accent font-bold flex items-center justify-center flex-shrink-0`}
    >
      R
    </span>
  );
}

export default Avatar;

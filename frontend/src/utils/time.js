export const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const timeOf = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// "Today" / "Yesterday" / "Mon, Oct 14" — used for the day separators in the
// message thread.
export const dayLabel = (date) => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, now)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

// Conversation list timestamp: time for today, otherwise a short day/date.
export const listTime = (value) => {
  const date = new Date(value);
  const now = new Date();
  if (isSameDay(date, now)) return timeOf(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';
  if ((now - date) / 86400000 < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

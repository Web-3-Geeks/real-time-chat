// Rounded speech bubble with three "typing" dots — the app's chat glyph,
// shared by the header, toasts and the empty chat state.
function ChatIcon({ size = 19, strokeWidth = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7.5 18.5 4 21.2V7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v7.5a4 4 0 0 1-4 4H7.5Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <circle cx="8.5" cy="10.75" r="1.15" fill="currentColor" />
      <circle cx="12" cy="10.75" r="1.15" fill="currentColor" />
      <circle cx="15.5" cy="10.75" r="1.15" fill="currentColor" />
    </svg>
  );
}

export default ChatIcon;

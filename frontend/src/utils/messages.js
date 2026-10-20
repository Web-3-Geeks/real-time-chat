// Must match ALLOWED_REACTIONS on the backend (services/chatService.js).
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export const attachmentUrl = (key) => `${import.meta.env.VITE_API_URL}/attachments/${key}`;

// One-line summary of a message for conversation previews, toasts and reply
// quotes — image messages have an empty (or caption-only) `content`.
export const previewText = (msg) => {
  if (!msg) return '';
  if (msg.isDeleted) return 'This message was deleted.';
  if (msg.messageType === 'image') return msg.content ? `📷 ${msg.content}` : '📷 Photo';
  return msg.content;
};

const ConversationMember = require("../models/ConversationMember");
const Message = require("../models/Message");

// Reactions are limited to a fixed set so a client can't store arbitrary
// strings (or huge payloads) on someone else's message.
const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const REPLY_SELECT = "content senderId messageType isDeleted";

// The quoted-message preview attached to a reply. Same shape whether it comes
// from a populate() (history) or is built by hand for a live event.
const toReplySnapshot = (reply) => {
  if (!reply) return null;
  const sender = reply.senderId;
  return {
    _id: reply._id.toString(),
    content: reply.isDeleted ? "This message was deleted." : reply.content,
    messageType: reply.messageType,
    isDeleted: reply.isDeleted,
    senderId:
      sender && typeof sender === "object" && sender.name
        ? { _id: sender._id.toString(), name: sender.name }
        : sender?.toString(),
  };
};

const loadReplySnapshot = async (replyToId) => {
  if (!replyToId) return null;
  const reply = await Message.findById(replyToId)
    .select(REPLY_SELECT)
    .populate("senderId", "name");
  return toReplySnapshot(reply);
};

// Shape of a message as broadcast in `receive_message`.
const toMessagePayload = (message, replySnapshot = null) => ({
  id: message._id,
  conversationId: message.conversationId,
  senderId: message.senderId,
  content: message.content,
  messageType: message.messageType,
  attachment: message.attachment?.key ? message.attachment : undefined,
  replyTo: replySnapshot,
  reactions: [],
  createdAt: message.createdAt,
  edited: false,
  isDeleted: false,
});

const getMemberIds = async (conversationId) => {
  const ids = await ConversationMember.find({ conversationId }).distinct("userId");
  return ids.map((id) => id.toString());
};

const emitToUsers = (io, userIds, event, payload) => {
  userIds.forEach((userId) => io.to(userId.toString()).emit(event, payload));
};

// Groups created before roles existed have no admin row: fall back to the
// creator, i.e. the first membership inserted (lowest _id), so every group
// always has at least one admin.
const getGroupAdminIds = async (conversationId) => {
  const memberships = await ConversationMember.find({ conversationId })
    .sort({ _id: 1 })
    .select("userId role");
  const admins = memberships
    .filter((m) => m.role === "admin")
    .map((m) => m.userId.toString());
  if (admins.length === 0 && memberships.length > 0) {
    return [memberships[0].userId.toString()];
  }
  return admins;
};

// Group fields shared by every member's view (members, admins, name) — the
// per-user bits (unreadCount, lastMessage) come from listConversations.
const buildGroupPayload = async (conversation) => {
  const memberships = await ConversationMember.find({
    conversationId: conversation._id,
  }).populate("userId", "name avatar");

  return {
    _id: conversation._id,
    type: "group",
    name: conversation.name,
    members: memberships.map((m) => m.userId).filter(Boolean),
    admins: await getGroupAdminIds(conversation._id),
  };
};

// Persists a "system" event line in the group's history (e.g. "Ali added
// Sara") and delivers it like a normal message, so it shows up live, in the
// conversation preview, and in history for anyone who joins later.
const createSystemMessage = async (io, conversationId, actorId, content) => {
  const message = await Message.create({
    conversationId,
    senderId: actorId,
    content,
    messageType: "system",
    deliveredTo: [actorId],
    readBy: [actorId],
  });
  const memberIds = await getMemberIds(conversationId);
  emitToUsers(io, memberIds, "receive_message", toMessagePayload(message));
  return message;
};

module.exports = {
  ALLOWED_REACTIONS,
  REPLY_SELECT,
  toReplySnapshot,
  loadReplySnapshot,
  toMessagePayload,
  getMemberIds,
  emitToUsers,
  getGroupAdminIds,
  buildGroupPayload,
  createSystemMessage,
};

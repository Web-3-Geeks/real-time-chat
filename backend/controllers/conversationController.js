const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const ConversationMember = require("../models/ConversationMember");
const Message = require("../models/Message");
const User = require("../models/User");
const Attachment = require("../models/Attachment");
const {
  REPLY_SELECT,
  getMemberIds,
  emitToUsers,
  getGroupAdminIds,
  buildGroupPayload,
  createSystemMessage,
} = require("../services/chatService");

const isValidId = (id) => typeof id === "string" && mongoose.Types.ObjectId.isValid(id);

const createOrGetConversation = async (req, res) => {
  try {
    const { type, recipientId } = req.body;

    if (type === "group") {
      return createGroupConversation(req, res);
    }

    if (!recipientId) {
      return res.status(400).json({ message: "recipientId is required" });
    }

    if (!isValidId(recipientId)) {
      return res.status(400).json({ message: "Invalid recipientId" });
    }

    if (recipientId === req.user._id.toString()) {
      return res
        .status(400)
        .json({ message: "Cannot start a conversation with yourself" });
    }

    const pairKey = [req.user._id.toString(), recipientId].sort().join("_");

    let conversation;
    try {
      conversation = await Conversation.create({ type: "private", pairKey });

      await ConversationMember.create([
        { conversationId: conversation._id, userId: req.user._id },
        { conversationId: conversation._id, userId: recipientId },
      ]);
    } catch (err) {
      if (err.code === 11000) {
        conversation = await Conversation.findOne({ pairKey, type: "private" });
      } else {
        throw err;
      }
    }

    res.status(200).json(conversation);
  } catch (error) {
    console.error("createOrGetConversation error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const createGroupConversation = async (req, res) => {
  try {
    const { name, memberIds } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Group name is required" });
    }

    if (!Array.isArray(memberIds) || memberIds.length < 2) {
      return res.status(400).json({ message: "At least 2 members are required" });
    }

    const uniqueMemberIds = [...new Set(memberIds.map((id) => id.toString()))];

    if (uniqueMemberIds.length !== memberIds.length) {
      return res.status(400).json({ message: "Duplicate members are not allowed" });
    }

    if (!uniqueMemberIds.every(isValidId)) {
      return res.status(400).json({ message: "One or more member ids are invalid" });
    }

    if (uniqueMemberIds.includes(req.user._id.toString())) {
      return res
        .status(400)
        .json({ message: "You are added automatically, don't include yourself in memberIds" });
    }

    const existingUsers = await User.find({ _id: { $in: uniqueMemberIds } });
    if (existingUsers.length !== uniqueMemberIds.length) {
      return res.status(400).json({ message: "One or more selected users do not exist" });
    }

    const conversation = await Conversation.create({ type: "group", name: name.trim() });

    const allMemberIds = [req.user._id.toString(), ...uniqueMemberIds];
    await ConversationMember.create(
      allMemberIds.map((userId, i) => ({
        conversationId: conversation._id,
        userId,
        role: i === 0 ? "admin" : "member",
      }))
    );

    // Lets the other members see the new group right away, instead of only
    // once someone sends the first message.
    const io = req.app.get("io");
    if (io) {
      await createSystemMessage(
        io,
        conversation._id,
        req.user._id,
        `${req.user.name} created the group "${conversation.name}"`
      );
    }

    res.status(201).json({ ...conversation.toObject(), admins: [req.user._id.toString()] });
  } catch (error) {
    console.error("createGroupConversation error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, before } = req.query;

    if (!isValidId(conversationId)) {
      return res.status(400).json({ message: "Invalid conversation id" });
    }

    const isMember = await ConversationMember.findOne({
      conversationId,
      userId: req.user._id,
    });

    if (!isMember) {
      return res
        .status(403)
        .json({ message: "You are not a member of this conversation" });
    }

    const query = { conversationId };
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .populate("senderId", "name avatar")
      .populate({
        path: "replyTo",
        select: REPLY_SELECT,
        populate: { path: "senderId", select: "name" },
      });

    res.status(200).json(messages.reverse());
  } catch (error) {
    console.error("getMessages error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const listConversations = async (req, res) => {
  try {
    const myConversationIds = await ConversationMember.find({
      userId: req.user._id,
    }).distinct("conversationId");

    const conversations = await Conversation.find({
      _id: { $in: myConversationIds },
    }).sort({ updatedAt: -1 });

    const results = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await Message.findOne({
          conversationId: conv._id,
        }).sort({ createdAt: -1 });

        const unreadCount = await Message.countDocuments({
          conversationId: conv._id,
          senderId: { $ne: req.user._id },
          readBy: { $ne: req.user._id },
        });

        const base = {
          _id: conv._id,
          type: conv.type,
          lastMessage: lastMessage
            ? {
                _id: lastMessage._id,
                content: lastMessage.content,
                messageType: lastMessage.messageType,
                isDeleted: lastMessage.isDeleted,
                createdAt: lastMessage.createdAt,
              }
            : null,
          updatedAt: conv.updatedAt,
          unreadCount,
        };

        if (conv.type === "group") {
          const memberships = await ConversationMember.find({
            conversationId: conv._id,
          }).populate("userId", "name avatar");

          return {
            ...base,
            name: conv.name,
            members: memberships.map((m) => m.userId).filter(Boolean),
            admins: await getGroupAdminIds(conv._id),
          };
        }

        const otherMembership = await ConversationMember.findOne({
          conversationId: conv._id,
          userId: { $ne: req.user._id },
        }).populate("userId", "name avatar");

        return {
          ...base,
          otherUser: otherMembership?.userId || null,
        };
      })
    );

    res.status(200).json(results);
  } catch (error) {
    console.error("listConversations error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------------------------------------------------------------------
// Group management
// ---------------------------------------------------------------------------

// Loads the group and checks the requester's membership (and admin rights
// when `requireAdmin`). Sends the error response itself and returns null on
// failure, so callers just `if (!ctx) return;`.
const loadGroup = async (req, res, { requireAdmin }) => {
  const { conversationId } = req.params;

  if (!isValidId(conversationId)) {
    res.status(400).json({ message: "Invalid conversation id" });
    return null;
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation || conversation.type !== "group") {
    res.status(404).json({ message: "Group not found" });
    return null;
  }

  const isMember = await ConversationMember.exists({
    conversationId,
    userId: req.user._id,
  });
  if (!isMember) {
    res.status(403).json({ message: "You are not a member of this group" });
    return null;
  }

  const adminIds = await getGroupAdminIds(conversationId);
  if (requireAdmin && !adminIds.includes(req.user._id.toString())) {
    res.status(403).json({ message: "Only group admins can do this" });
    return null;
  }

  return { conversation, adminIds };
};

// Legacy groups have no explicit admin row (the creator is implied — see
// getGroupAdminIds). Before changing roles, persist that implied admin so
// promoting someone else doesn't silently strip the creator's rights.
const materializeAdmins = async (conversationId, adminIds) => {
  await ConversationMember.updateMany(
    { conversationId, userId: { $in: adminIds } },
    { $set: { role: "admin" } }
  );
};

// Pushes the group's new name/members/admins to every current member.
const broadcastGroupUpdate = async (io, conversation) => {
  if (!io) return null;
  const payload = await buildGroupPayload(conversation);
  emitToUsers(
    io,
    payload.members.map((m) => m._id),
    "conversation_updated",
    payload
  );
  return payload;
};

// Tells a removed/departed user to drop the group, and takes their sockets
// out of its room so they stop receiving typing events for it.
const detachUser = (io, conversationId, userId) => {
  if (!io) return;
  io.in(userId.toString()).socketsLeave(conversationId.toString());
  io.to(userId.toString()).emit("conversation_removed", {
    conversationId: conversationId.toString(),
  });
};

const joinNames = (names) =>
  names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

const renameGroup = async (req, res) => {
  try {
    const ctx = await loadGroup(req, res, { requireAdmin: true });
    if (!ctx) return;

    const name = (req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ message: "Group name is required" });
    }
    if (name.length > 100) {
      return res.status(400).json({ message: "Group name is too long (max 100 characters)" });
    }

    const { conversation } = ctx;
    if (name === conversation.name) {
      return res.status(200).json(await buildGroupPayload(conversation));
    }

    conversation.name = name;
    await conversation.save();

    const io = req.app.get("io");
    const payload = await broadcastGroupUpdate(io, conversation);
    if (io) {
      await createSystemMessage(io, conversation._id, req.user._id, `${req.user.name} renamed the group to "${name}"`);
    }

    res.status(200).json(payload || (await buildGroupPayload(conversation)));
  } catch (error) {
    console.error("renameGroup error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const addGroupMembers = async (req, res) => {
  try {
    const ctx = await loadGroup(req, res, { requireAdmin: true });
    if (!ctx) return;
    const { conversation } = ctx;

    const { memberIds } = req.body || {};
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ message: "Select at least 1 member to add" });
    }

    const uniqueIds = [...new Set(memberIds.map((id) => String(id)))];
    if (!uniqueIds.every(isValidId)) {
      return res.status(400).json({ message: "One or more member ids are invalid" });
    }

    const existingMemberIds = await getMemberIds(conversation._id);
    const newIds = uniqueIds.filter((id) => !existingMemberIds.includes(id));
    if (newIds.length === 0) {
      return res.status(400).json({ message: "Selected users are already in the group" });
    }

    const users = await User.find({ _id: { $in: newIds } }).select("name");
    if (users.length !== newIds.length) {
      return res.status(400).json({ message: "One or more selected users do not exist" });
    }

    await ConversationMember.create(
      newIds.map((userId) => ({ conversationId: conversation._id, userId, role: "member" }))
    );

    const io = req.app.get("io");
    const payload = await broadcastGroupUpdate(io, conversation);
    if (io) {
      await createSystemMessage(
        io,
        conversation._id,
        req.user._id,
        `${req.user.name} added ${joinNames(users.map((u) => u.name))}`
      );
    }

    res.status(200).json(payload || (await buildGroupPayload(conversation)));
  } catch (error) {
    console.error("addGroupMembers error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const removeGroupMember = async (req, res) => {
  try {
    const ctx = await loadGroup(req, res, { requireAdmin: true });
    if (!ctx) return;
    const { conversation, adminIds } = ctx;
    const { userId } = req.params;

    if (!isValidId(userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ message: "Use 'Leave group' to remove yourself" });
    }

    const target = await ConversationMember.findOne({
      conversationId: conversation._id,
      userId,
    }).populate("userId", "name");
    if (!target) {
      return res.status(404).json({ message: "User is not a member of this group" });
    }

    // Keep the implied (legacy) admin explicit before the member list shifts.
    await materializeAdmins(conversation._id, adminIds);
    await target.deleteOne();

    const io = req.app.get("io");
    detachUser(io, conversation._id, userId);
    const payload = await broadcastGroupUpdate(io, conversation);
    if (io) {
      await createSystemMessage(
        io,
        conversation._id,
        req.user._id,
        `${req.user.name} removed ${target.userId?.name || "a member"}`
      );
    }

    res.status(200).json(payload || (await buildGroupPayload(conversation)));
  } catch (error) {
    console.error("removeGroupMember error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const setMemberRole = async (req, res) => {
  try {
    const ctx = await loadGroup(req, res, { requireAdmin: true });
    if (!ctx) return;
    const { conversation, adminIds } = ctx;
    const { userId } = req.params;
    const { role } = req.body || {};

    if (!isValidId(userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    if (!["admin", "member"].includes(role)) {
      return res.status(400).json({ message: "Role must be 'admin' or 'member'" });
    }

    const target = await ConversationMember.findOne({
      conversationId: conversation._id,
      userId,
    }).populate("userId", "name");
    if (!target) {
      return res.status(404).json({ message: "User is not a member of this group" });
    }

    if (role === "member" && adminIds.length === 1 && adminIds[0] === userId) {
      return res.status(400).json({ message: "A group needs at least one admin" });
    }

    await materializeAdmins(conversation._id, adminIds);
    target.role = role;
    await target.save();

    const io = req.app.get("io");
    const payload = await broadcastGroupUpdate(io, conversation);
    if (io) {
      const name = target.userId?.name || "a member";
      await createSystemMessage(
        io,
        conversation._id,
        req.user._id,
        role === "admin"
          ? `${req.user.name} made ${name} an admin`
          : `${req.user.name} removed ${name} as admin`
      );
    }

    res.status(200).json(payload || (await buildGroupPayload(conversation)));
  } catch (error) {
    console.error("setMemberRole error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const leaveGroup = async (req, res) => {
  try {
    const ctx = await loadGroup(req, res, { requireAdmin: false });
    if (!ctx) return;
    const { conversation, adminIds } = ctx;
    const me = req.user._id.toString();

    await materializeAdmins(conversation._id, adminIds);
    await ConversationMember.deleteOne({ conversationId: conversation._id, userId: me });

    const io = req.app.get("io");
    detachUser(io, conversation._id, me);

    const remaining = await ConversationMember.find({ conversationId: conversation._id }).sort({ _id: 1 });

    if (remaining.length === 0) {
      // Nobody left to read it — clean up the group, its messages and images.
      const keys = await Message.find({
        conversationId: conversation._id,
        "attachment.key": { $exists: true },
      }).distinct("attachment.key");
      await Promise.all([
        Message.deleteMany({ conversationId: conversation._id }),
        Attachment.deleteMany({ key: { $in: keys } }),
        conversation.deleteOne(),
      ]);
      return res.status(200).json({ success: true });
    }

    // The last admin left: hand admin to the longest-standing member.
    if (!remaining.some((m) => m.role === "admin")) {
      remaining[0].role = "admin";
      await remaining[0].save();
    }

    await broadcastGroupUpdate(io, conversation);
    if (io) {
      await createSystemMessage(io, conversation._id, req.user._id, `${req.user.name} left the group`);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("leaveGroup error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  createOrGetConversation,
  createGroupConversation,
  getMessages,
  listConversations,
  renameGroup,
  addGroupMembers,
  removeGroupMember,
  setMemberRole,
  leaveGroup,
};

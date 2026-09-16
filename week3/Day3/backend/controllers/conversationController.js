const Conversation = require("../models/Conversation");
const ConversationMember = require("../models/ConversationMember");
const Message = require("../models/Message");
const User = require("../models/User");

const createOrGetConversation = async (req, res) => {
  try {
    const { type, recipientId } = req.body;

    if (type === "group") {
      return createGroupConversation(req, res);
    }

    if (!recipientId) {
      return res.status(400).json({ message: "recipientId is required" });
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
    res.status(500).json({ message: "Server error", error: error.message });
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
      allMemberIds.map((userId) => ({ conversationId: conversation._id, userId }))
    );

    res.status(201).json(conversation);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, before } = req.query;

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
      .populate("senderId", "name avatar");

    res.status(200).json(messages.reverse());
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
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

        const base = {
          _id: conv._id,
          type: conv.type,
          lastMessage: lastMessage
            ? { content: lastMessage.content, createdAt: lastMessage.createdAt }
            : null,
          updatedAt: conv.updatedAt,
        };

        if (conv.type === "group") {
          const memberships = await ConversationMember.find({
            conversationId: conv._id,
          }).populate("userId", "name avatar");

          return {
            ...base,
            name: conv.name,
            members: memberships.map((m) => m.userId),
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
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  createOrGetConversation,
  createGroupConversation,
  getMessages,
  listConversations,
};

const Conversation = require("../models/Conversation");
const ConversationMember = require("../models/ConversationMember");
const Message = require("../models/Message");

const createOrGetConversation = async (req, res) => {
  try {
    const { recipientId } = req.body;

    if (!recipientId) {
      return res.status(400).json({ message: "recipientId is required" });
    }

    if (recipientId === req.user._id.toString()) {
      return res
        .status(400)
        .json({ message: "Cannot start a conversation with yourself" });
    }

    const myConversationIds = await ConversationMember.find({
      userId: req.user._id,
    }).distinct("conversationId");

    const sharedMembership = await ConversationMember.findOne({
      userId: recipientId,
      conversationId: { $in: myConversationIds },
    });

    let conversation = null;

    if (sharedMembership) {
      conversation = await Conversation.findOne({
        _id: sharedMembership.conversationId,
        type: "private",
      });
    }

    if (!conversation) {
      conversation = await Conversation.create({ type: "private" });

      await ConversationMember.create([
        { conversationId: conversation._id, userId: req.user._id },
        { conversationId: conversation._id, userId: recipientId },
      ]);
    }

    res.status(200).json(conversation);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
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
      return res.status(403).json({ message: "You are not a member of this conversation" });
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
      type: "private",
    }).sort({ updatedAt: -1 });

    const results = await Promise.all(
      conversations.map(async (conv) => {
        const otherMembership = await ConversationMember.findOne({
          conversationId: conv._id,
          userId: { $ne: req.user._id },
        }).populate("userId", "name avatar");

        const lastMessage = await Message.findOne({ conversationId: conv._id }).sort({
          createdAt: -1,
        });

        return {
          _id: conv._id,
          otherUser: otherMembership?.userId || null,
          lastMessage: lastMessage
            ? { content: lastMessage.content, createdAt: lastMessage.createdAt }
            : null,
          updatedAt: conv.updatedAt,
        };
      })
    );

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = { createOrGetConversation, getMessages, listConversations };

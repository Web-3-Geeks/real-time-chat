const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const ConversationMember = require("../models/ConversationMember");
const Message = require("../models/Message");
const connectDB = require("../config/db");

// A malformed id (not a valid ObjectId) would otherwise reach Mongoose and
// throw a CastError — safe() stops that from crashing the process, but every
// caller still deserves a clean rejection instead of a generic "Server error".
const isValidId = (id) => typeof id === "string" && mongoose.Types.ObjectId.isValid(id);

// userId (string) -> Set of socket ids. Lets one user have multiple tabs/devices
// open at once without flipping online/offline on every single connect/disconnect.
const onlineUsers = new Map();

const getConversationPartnerIds = async (userId) => {
  const myConversationIds = await ConversationMember.find({ userId }).distinct(
    "conversationId",
  );

  const partnerIds = await ConversationMember.find({
    conversationId: { $in: myConversationIds },
    userId: { $ne: userId },
  }).distinct("userId");

  return [...new Set(partnerIds.map((id) => id.toString()))];
};

// Wraps an async socket event handler so a thrown/rejected error is logged
// instead of crashing the whole process (Socket.io does not catch these itself).
const safe = (handler) => async (...args) => {
  try {
    await handler(...args);
  } catch (error) {
    console.error("Socket handler error:", error.message);
    const callback = args[args.length - 1];
    if (typeof callback === "function") {
      callback({ success: false, message: "Server error" });
    }
  }
};

const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL,
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Not authorized, no token"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch (error) {
      next(new Error("Not authorized, token failed"));
    }
  });

  io.on(
    "connection",
    safe(async (socket) => {
      console.log(`Socket connected: ${socket.id} (user: ${socket.userId})`);

      // Event listeners must be registered synchronously, before any `await`
      // below. If we awaited connectDB()/catch-up queries first, a client that
      // emits (e.g. join_conversation) right after connecting could fire before
      // the server ever attaches a listener for it — Socket.io does not buffer
      // events for listeners added later, so the emit would be silently lost
      // and its ack would never come. Registering handlers first, then doing
      // the slower async setup, closes that race.
      socket.join(socket.userId);
      socket.typingIn = new Set();

      const stopTyping = (conversationId) => {
        if (!socket.typingIn.has(conversationId)) return;
        socket.typingIn.delete(conversationId);
        socket.to(conversationId).emit("typing_stop", {
          conversationId,
          userId: socket.userId,
        });
      };

      socket.on(
        "join_conversation",
        safe(async (conversationId, callback) => {
          if (!isValidId(conversationId)) {
            if (callback) callback({ success: false, message: "Invalid conversation id" });
            return;
          }

          const isMember = await ConversationMember.findOne({
            conversationId,
            userId: socket.userId,
          });

          if (!isMember) {
            if (callback)
              callback({
                success: false,
                message: "Not a member of this conversation",
              });
            return;
          }

          socket.join(conversationId);
          console.log(
            `User ${socket.userId} joined conversation ${conversationId}`,
          );

          if (callback) {
            const memberIds = await ConversationMember.find({
              conversationId,
            }).distinct("userId");

            const onlineMembers = memberIds
              .map((id) => id.toString())
              .filter((id) => onlineUsers.has(id));

            callback({ success: true, onlineMembers });
          }
        }),
      );

      socket.on(
        "leave_conversation",
        safe(async (conversationId) => {
          if (!isValidId(conversationId)) return;
          socket.leave(conversationId);
          stopTyping(conversationId);
          console.log(`User ${socket.userId} left conversation ${conversationId}`);
        }),
      );

      socket.on(
        "send_message",
        safe(async (data, callback) => {
          const { conversationId, content } = data || {};

          if (!isValidId(conversationId)) {
            if (callback) callback({ success: false, message: "Invalid conversation id" });
            return;
          }

          const isMember = await ConversationMember.findOne({
            conversationId,
            userId: socket.userId,
          });

          if (!isMember) {
            if (callback) callback({ success: false, message: "Not a member of this conversation" });
            return;
          }

          if (!content || !content.trim()) {
            if (callback) callback({ success: false, message: "Message cannot be empty" });
            return;
          }

          if (content.length > 5000) {
            if (callback) callback({ success: false, message: "Message is too long (max 5000 characters)" });
            return;
          }

          const message = await Message.create({
            conversationId,
            senderId: socket.userId,
            content: content.trim(),
          });

          stopTyping(conversationId);

          const payload = {
            id: message._id,
            conversationId: message.conversationId,
            senderId: message.senderId,
            content: message.content,
            createdAt: message.createdAt,
            edited: false,
            isDeleted: false,
          };

          // Deliver to every member's personal room (joined by userId on connect),
          // not just the conversation room — a member who hasn't opened this
          // conversation right now still needs the event to show an unread badge.
          const memberIds = await ConversationMember.find({ conversationId }).distinct(
            "userId",
          );
          memberIds.forEach((memberId) => {
            io.to(memberId.toString()).emit("receive_message", payload);
          });

          // Anyone else online right now receives it in this same tick, so mark
          // it delivered to them immediately instead of waiting for a reconnect.
          const onlineRecipients = memberIds
            .map((id) => id.toString())
            .filter((id) => id !== socket.userId && onlineUsers.has(id));

          if (onlineRecipients.length > 0) {
            await Message.updateOne(
              { _id: message._id },
              { $addToSet: { deliveredTo: { $each: onlineRecipients } } },
            );
            onlineRecipients.forEach((userId) => {
              io.to(socket.userId).emit("message_delivered", {
                conversationId: conversationId.toString(),
                messageIds: [message._id.toString()],
                userId,
              });
            });
          }

          if (callback) callback({ success: true, id: message._id });
        }),
      );

      socket.on(
        "mark_messages_read",
        safe(async (conversationId) => {
          if (!isValidId(conversationId)) return;

          const isMember = await ConversationMember.findOne({
            conversationId,
            userId: socket.userId,
          });
          if (!isMember) return;

          const unread = await Message.find({
            conversationId,
            senderId: { $ne: socket.userId },
            readBy: { $ne: socket.userId },
          });

          if (unread.length === 0) return;

          const messageIds = unread.map((m) => m._id);
          await Message.updateMany(
            { _id: { $in: messageIds } },
            {
              $addToSet: { readBy: socket.userId, deliveredTo: socket.userId },
            },
          );

          const memberIds = await ConversationMember.find({ conversationId }).distinct(
            "userId",
          );
          memberIds.forEach((memberId) => {
            io.to(memberId.toString()).emit("message_read", {
              conversationId: conversationId.toString(),
              messageIds: messageIds.map((id) => id.toString()),
              userId: socket.userId,
            });
          });
        }),
      );

      socket.on(
        "edit_message",
        safe(async ({ messageId, content } = {}, callback) => {
          if (!isValidId(messageId)) {
            if (callback) callback({ success: false, message: "Invalid message id" });
            return;
          }

          if (content && content.length > 5000) {
            if (callback) callback({ success: false, message: "Message is too long (max 5000 characters)" });
            return;
          }

          const message = await Message.findById(messageId);

          if (!message || message.senderId.toString() !== socket.userId) {
            if (callback) callback({ success: false, message: "Not authorized to edit this message" });
            return;
          }

          if (message.isDeleted) {
            if (callback) callback({ success: false, message: "Cannot edit a deleted message" });
            return;
          }

          if (!content || !content.trim()) {
            if (callback) callback({ success: false, message: "Message cannot be empty" });
            return;
          }

          message.content = content.trim();
          message.edited = true;
          message.editedAt = new Date();
          await message.save();

          const memberIds = await ConversationMember.find({
            conversationId: message.conversationId,
          }).distinct("userId");

          memberIds.forEach((memberId) => {
            io.to(memberId.toString()).emit("message_edited", {
              id: message._id.toString(),
              conversationId: message.conversationId.toString(),
              content: message.content,
              edited: true,
              editedAt: message.editedAt,
            });
          });

          if (callback) callback({ success: true });
        }),
      );

      socket.on(
        "delete_message",
        safe(async ({ messageId } = {}, callback) => {
          if (!isValidId(messageId)) {
            if (callback) callback({ success: false, message: "Invalid message id" });
            return;
          }

          const message = await Message.findById(messageId);

          if (!message || message.senderId.toString() !== socket.userId) {
            if (callback) callback({ success: false, message: "Not authorized to delete this message" });
            return;
          }

          message.isDeleted = true;
          message.content = "This message was deleted.";
          await message.save();

          const memberIds = await ConversationMember.find({
            conversationId: message.conversationId,
          }).distinct("userId");

          memberIds.forEach((memberId) => {
            io.to(memberId.toString()).emit("message_deleted", {
              id: message._id.toString(),
              conversationId: message.conversationId.toString(),
              content: message.content,
              isDeleted: true,
            });
          });

          if (callback) callback({ success: true });
        }),
      );

      socket.on(
        "typing_start",
        safe(async (conversationId) => {
          if (!isValidId(conversationId)) return;

          const isMember = await ConversationMember.findOne({
            conversationId,
            userId: socket.userId,
          });
          if (!isMember) return;

          if (socket.typingIn.has(conversationId)) return;
          socket.typingIn.add(conversationId);

          socket.to(conversationId).emit("typing_start", {
            conversationId,
            userId: socket.userId,
          });
        }),
      );

      socket.on(
        "typing_stop",
        safe(async (conversationId) => {
          if (!isValidId(conversationId)) return;
          stopTyping(conversationId);
        }),
      );

      socket.on(
        "disconnect",
        safe(async () => {
          console.log(`Socket disconnected: ${socket.id} (user: ${socket.userId})`);

          socket.typingIn.forEach((conversationId) => stopTyping(conversationId));

          const sockets = onlineUsers.get(socket.userId);
          if (!sockets) return;

          sockets.delete(socket.id);
          if (sockets.size === 0) {
            onlineUsers.delete(socket.userId);

            const partnerIds = await getConversationPartnerIds(socket.userId);
            partnerIds.forEach((partnerId) => {
              io.to(partnerId).emit("user_offline", { userId: socket.userId });
            });
          }
        }),
      );

      // Slower async setup runs after every listener above is already
      // attached, so an event the client fires immediately on connect is
      // never missed (see comment above).
      await connectDB();

      const wasOffline = !onlineUsers.has(socket.userId);
      if (wasOffline) onlineUsers.set(socket.userId, new Set());
      onlineUsers.get(socket.userId).add(socket.id);

      if (wasOffline) {
        const partnerIds = await getConversationPartnerIds(socket.userId);
        partnerIds.forEach((partnerId) => {
          io.to(partnerId).emit("user_online", { userId: socket.userId });
        });
      }

      // Catch-up delivery: any message in one of my conversations that I hadn't
      // received yet (sent while I was offline) counts as delivered now that
      // I'm connected. Tell each sender which of their messages just landed.
      const myConversationIds = await ConversationMember.find({
        userId: socket.userId,
      }).distinct("conversationId");

      const undelivered = await Message.find({
        conversationId: { $in: myConversationIds },
        senderId: { $ne: socket.userId },
        deliveredTo: { $ne: socket.userId },
        isDeleted: false,
      });

      if (undelivered.length > 0) {
        await Message.updateMany(
          { _id: { $in: undelivered.map((m) => m._id) } },
          { $addToSet: { deliveredTo: socket.userId } },
        );

        const bySender = new Map();
        undelivered.forEach((m) => {
          const senderId = m.senderId.toString();
          const convId = m.conversationId.toString();
          const key = `${senderId}:${convId}`;
          if (!bySender.has(key)) {
            bySender.set(key, { senderId, conversationId: convId, messageIds: [] });
          }
          bySender.get(key).messageIds.push(m._id.toString());
        });

        bySender.forEach(({ senderId, conversationId, messageIds }) => {
          io.to(senderId).emit("message_delivered", {
            conversationId,
            messageIds,
            userId: socket.userId,
          });
        });
      }
    }),
  );

  return io;
};

module.exports = initSocket;

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const ConversationMember = require("../models/ConversationMember");
const Message = require("../models/Message");
const connectDB = require("../config/db");

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

      await connectDB();

      socket.join(socket.userId);
      socket.typingIn = new Set();

      const wasOffline = !onlineUsers.has(socket.userId);
      if (wasOffline) onlineUsers.set(socket.userId, new Set());
      onlineUsers.get(socket.userId).add(socket.id);

      if (wasOffline) {
        const partnerIds = await getConversationPartnerIds(socket.userId);
        partnerIds.forEach((partnerId) => {
          io.to(partnerId).emit("user_online", { userId: socket.userId });
        });
      }

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
          socket.leave(conversationId);
          stopTyping(conversationId);
          console.log(`User ${socket.userId} left conversation ${conversationId}`);
        }),
      );

      socket.on(
        "send_message",
        safe(async (data, callback) => {
          const { conversationId, content } = data;

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

          if (callback) callback({ success: true });
        }),
      );

      socket.on(
        "typing_start",
        safe(async (conversationId) => {
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
    }),
  );

  return io;
};

module.exports = initSocket;

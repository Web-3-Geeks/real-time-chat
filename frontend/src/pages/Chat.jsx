import { useState, useEffect, useRef, Fragment } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import Avatar from '../components/Avatar';
import ChatIcon from '../components/ChatIcon';
import GroupDetails from '../components/GroupDetails';
import axiosInstance from '../api/axiosInstance';
import { REACTIONS, attachmentUrl, previewText } from '../utils/messages';
import { prepareImage } from '../utils/image';
import { isSameDay, timeOf, dayLabel, listTime } from '../utils/time';
import { getSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';

const getSenderId = (msg) => (typeof msg.senderId === 'object' ? msg.senderId._id : msg.senderId);

const conversationLabel = (conv) => (conv.type === 'group' ? conv.name : conv.otherUser?.name || 'Unknown');

const EMOJIS = ['😀', '😂', '😊', '😍', '🥳', '😎', '🤔', '😅', '😢', '😡', '👍', '👎', '👏', '🙏', '🔥', '❤️', '🎉', '✅', '👀', '💯', '🙌', '🤝', '☕', '🚀'];

// Web Speech API (Chrome/Edge/Safari). Null where unsupported — the mic
// button is simply hidden then.
const SpeechRecognitionImpl =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const TYPING_TIMEOUT_MS = 2000;
const MESSAGES_PAGE_SIZE = 30;
const NEAR_BOTTOM_THRESHOLD = 100;

function Chat() {
  const { user, socketStatus } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [dividerMessageId, setDividerMessageId] = useState(null);
  const [messageInput, setMessageInput] = useState('');
  const [error, setError] = useState('');
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [typingUserIds, setTypingUserIds] = useState(new Set());
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [toasts, setToasts] = useState([]);

  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editContent, setEditContent] = useState('');

  const [allUsers, setAllUsers] = useState([]);
  // 'all' | 'unread' | 'favorites' | 'private' | 'group' — can be preset by
  // the header bell (?tab=unread) when arriving from another page.
  const [activeTab, setActiveTab] = useState(() => location.state?.tab || 'all');
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState('private'); // 'private' | 'group'
  const [groupName, setGroupName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState([]);
  const [search, setSearch] = useState(() => location.state?.search || '');
  const [showListSearch, setShowListSearch] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState(null);

  const [replyingTo, setReplyingTo] = useState(null); // message being replied to
  const [reactionPickerFor, setReactionPickerFor] = useState(null); // message id
  const [selectedMessageId, setSelectedMessageId] = useState(null); // mobile: tapped bubble shows its actions
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const [pendingImage, setPendingImage] = useState(null); // { blob, previewUrl, name }
  const [isUploading, setIsUploading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // Favorites are a per-user, per-browser preference (no backend field for
  // them), so they live in localStorage keyed by the user id.
  const favoritesKey = `favorites:${user?._id}`;
  const [favoriteIds, setFavoriteIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(favoritesKey)) || [];
    } catch {
      return [];
    }
  });

  const messagesEndRef = useRef(null);
  const messageInputRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const recognitionRef = useRef(null);
  const fileInputRef = useRef(null);
  const reactionPickerRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const activeConversationRef = useRef(null);
  const conversationsRef = useRef([]);
  const isNearBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  // Groups we're leaving ourselves, so the resulting conversation_removed
  // event doesn't show a "You were removed" toast.
  const leavingIdsRef = useRef(new Set());

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    axiosInstance.get('/users').then((res) => setAllUsers(res.data));
    axiosInstance
      .get('/conversations')
      .then((res) => setConversations(res.data))
      .finally(() => setLoadingConversations(false));
  }, []);

  // Ask for browser notification permission once, if the browser supports it
  // and the user hasn't already answered. The app works fine either way.
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Keep the message list scrolled correctly: jump to the restored scroll
  // position after prepending older messages, or auto-scroll to the bottom
  // for new messages — but only if the user was already near the bottom, so
  // we don't yank them away while they're reading history.
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    if (prevScrollHeightRef.current > 0) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = 0;
      return;
    }

    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Global listeners: independent of which conversation is currently open.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const bumpConversation = (conversationId, patch) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c._id === conversationId);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], ...patch(prev[idx]) };
        const rest = prev.filter((_, i) => i !== idx);
        return [updated, ...rest];
      });
    };

    const notify = (conv, msg) => {
      const senderName =
        conv?.type === 'group'
          ? conv.members?.find((m) => m._id === getSenderId(msg))?.name || 'Someone'
          : conv?.otherUser?.name || 'Someone';
      const toastId = (msg.id || msg._id)?.toString();
      // Group events ("Ali added you") read better titled by the group name.
      const title =
        msg.messageType === 'system'
          ? conv
            ? conversationLabel(conv)
            : 'Group update'
          : `${senderName} sent you a message`;
      const body = previewText(msg);

      setToasts((prev) => {
        if (prev.some((t) => t.id === toastId)) return prev;
        return [
          ...prev,
          {
            id: toastId,
            conversationId: msg.conversationId,
            title,
            body,
          },
        ];
      });
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, 5000);

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const notification = new Notification(title, { body });
        notification.onclick = () => {
          window.focus();
          navigate('/chat', { state: { openConversationId: msg.conversationId } });
          notification.close();
        };
      }
    };

    const handleReceive = (msg) => {
      const isSelf = getSenderId(msg) === user._id;
      const isActive = msg.conversationId === activeConversationRef.current?._id;
      const knownConv = conversationsRef.current.find((c) => c._id === msg.conversationId);

      if (!knownConv) {
        // Message for a conversation we don't have locally yet — e.g. someone
        // just started a brand-new chat/group with us. Re-fetch the full list
        // (with proper otherUser/members/type), then notify once we actually
        // know who it's from — building the toast off the stale local list
        // here would show "Someone" instead of their name.
        axiosInstance.get('/conversations').then((res) => {
          setConversations(res.data);
          if (!isSelf && !isActive) {
            const freshConv = res.data.find((c) => c._id === msg.conversationId);
            notify(freshConv, msg);
          }
        });
      } else {
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c._id === msg.conversationId);
          if (idx === -1) return prev;
          const updated = {
            ...prev[idx],
            lastMessage: {
              _id: (msg.id || msg._id)?.toString(),
              content: msg.content,
              messageType: msg.messageType,
              createdAt: msg.createdAt,
            },
            updatedAt: msg.createdAt,
            unreadCount: isSelf ? prev[idx].unreadCount || 0 : (prev[idx].unreadCount || 0) + 1,
          };
          const rest = prev.filter((_, i) => i !== idx);
          return [updated, ...rest];
        });
      }

      if (isActive) {
        setMessages((prev) => {
          const msgId = (msg.id || msg._id)?.toString();
          if (prev.some((m) => (m.id || m._id)?.toString() === msgId)) return prev;
          return [...prev, msg];
        });
        socket.emit('mark_messages_read', msg.conversationId);
        return;
      }

      if (isSelf || !knownConv) return;
      notify(knownConv, msg);
    };

    const handleOnline = ({ userId }) =>
      setOnlineUserIds((prev) => new Set(prev).add(userId));

    const handleOffline = ({ userId }) =>
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });

    const handleTypingStart = ({ conversationId, userId }) => {
      if (conversationId !== activeConversationRef.current?._id) return;
      setTypingUserIds((prev) => new Set(prev).add(userId));
    };

    const handleTypingStop = ({ conversationId, userId }) => {
      if (conversationId !== activeConversationRef.current?._id) return;
      setTypingUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    };

    const patchMessages = (conversationId, messageIds, patch) => {
      if (conversationId !== activeConversationRef.current?._id) return;
      const idSet = new Set(messageIds);
      setMessages((prev) =>
        prev.map((m) => (idSet.has((m.id || m._id)?.toString()) ? { ...m, ...patch(m) } : m))
      );
    };

    const handleDelivered = ({ conversationId, messageIds, userId }) => {
      patchMessages(conversationId, messageIds, (m) => ({
        deliveredTo: [...new Set([...(m.deliveredTo || []), userId])],
      }));
    };

    const handleRead = ({ conversationId, messageIds, userId }) => {
      patchMessages(conversationId, messageIds, (m) => ({
        readBy: [...new Set([...(m.readBy || []), userId])],
        deliveredTo: [...new Set([...(m.deliveredTo || []), userId])],
      }));
      if (userId === user._id) {
        bumpConversation(conversationId, () => ({ unreadCount: 0 }));
      }
    };

    // Also refreshes the quoted preview inside any reply to that message.
    const patchMessageAndQuotes = (id, patch) => {
      setMessages((prev) =>
        prev.map((m) => {
          let next = m;
          if ((m.id || m._id)?.toString() === id) next = { ...next, ...patch };
          if (m.replyTo?._id === id) next = { ...next, replyTo: { ...m.replyTo, ...patch } };
          return next;
        })
      );
    };

    // Keep the list preview in sync when its last message is edited/deleted.
    const patchLastMessage = (conversationId, id, patch) => {
      setConversations((prev) =>
        prev.map((c) =>
          c._id === conversationId && c.lastMessage?._id === id
            ? { ...c, lastMessage: { ...c.lastMessage, ...patch } }
            : c
        )
      );
    };

    const handleEdited = (updated) => {
      patchLastMessage(updated.conversationId, updated.id, { content: updated.content });
      patchMessageAndQuotes(updated.id, {
        content: updated.content,
        edited: true,
        editedAt: updated.editedAt,
      });
    };

    const handleDeleted = (updated) => {
      patchLastMessage(updated.conversationId, updated.id, { content: updated.content, isDeleted: true });
      patchMessageAndQuotes(updated.id, {
        content: updated.content,
        isDeleted: true,
        attachment: undefined,
        reactions: [],
      });
    };

    const handleReacted = ({ id, conversationId, reactions }) => {
      if (conversationId !== activeConversationRef.current?._id) return;
      setMessages((prev) =>
        prev.map((m) => ((m.id || m._id)?.toString() === id ? { ...m, reactions } : m))
      );
    };

    // Group renamed / members or admins changed. Unknown group = we were just
    // added: re-fetch so it arrives with our own unreadCount/lastMessage.
    const handleConversationUpdated = (group) => {
      const patch = { name: group.name, members: group.members, admins: group.admins };
      if (!conversationsRef.current.some((c) => c._id === group._id)) {
        axiosInstance.get('/conversations').then((res) => setConversations(res.data));
        return;
      }
      setConversations((prev) => prev.map((c) => (c._id === group._id ? { ...c, ...patch } : c)));
      setActiveConversation((prev) => (prev?._id === group._id ? { ...prev, ...patch } : prev));
    };

    // We were removed from a group (or left it, possibly from another tab).
    const handleConversationRemoved = ({ conversationId }) => {
      const conv = conversationsRef.current.find((c) => c._id === conversationId);
      const leftOnPurpose = leavingIdsRef.current.has(conversationId);
      setConversations((prev) => prev.filter((c) => c._id !== conversationId));
      if (activeConversationRef.current?._id === conversationId) {
        setActiveConversation(null);
        setMessages([]);
        setTypingUserIds(new Set());
        setShowDetails(false);
        setReplyingTo(null);
      }
      if (conv && !leftOnPurpose) {
        const toastId = `removed-${conversationId}`;
        setToasts((prev) => [
          ...prev.filter((t) => t.id !== toastId),
          { id: toastId, conversationId, title: `You were removed from "${conversationLabel(conv)}"`, body: '' },
        ]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toastId)), 5000);
      }
    };

    const handleConnect = () => {
      if (activeConversationRef.current) {
        socket.emit('join_conversation', activeConversationRef.current._id, () => {});
      }
    };

    socket.on('receive_message', handleReceive);
    socket.on('user_online', handleOnline);
    socket.on('user_offline', handleOffline);
    socket.on('typing_start', handleTypingStart);
    socket.on('typing_stop', handleTypingStop);
    socket.on('message_delivered', handleDelivered);
    socket.on('message_read', handleRead);
    socket.on('message_edited', handleEdited);
    socket.on('message_deleted', handleDeleted);
    socket.on('message_reacted', handleReacted);
    socket.on('conversation_updated', handleConversationUpdated);
    socket.on('conversation_removed', handleConversationRemoved);
    socket.on('connect', handleConnect);

    return () => {
      socket.off('receive_message', handleReceive);
      socket.off('user_online', handleOnline);
      socket.off('user_offline', handleOffline);
      socket.off('typing_start', handleTypingStart);
      socket.off('typing_stop', handleTypingStop);
      socket.off('message_delivered', handleDelivered);
      socket.off('message_read', handleRead);
      socket.off('message_edited', handleEdited);
      socket.off('message_deleted', handleDeleted);
      socket.off('message_reacted', handleReacted);
      socket.off('conversation_updated', handleConversationUpdated);
      socket.off('conversation_removed', handleConversationRemoved);
      socket.off('connect', handleConnect);
    };
    // Re-run once the socket actually exists/reconnects: on a fresh page load
    // that lands directly on this route, React fires this (child) component's
    // effects before AuthProvider's (parent) effect that creates the socket,
    // so getSocket() can still be null on the first pass — this depends on
    // socketStatus so it retries once AuthContext finishes connecting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketStatus]);

  const stopTypingSignal = (conversationId) => {
    clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      getSocket()?.emit('typing_stop', conversationId);
      isTypingRef.current = false;
    }
  };

  // Mobile only: the sidebar and the message pane occupy the full width and
  // toggle based on whether a conversation is open (there's no room to show
  // both side by side below the `sm` breakpoint) — this is the "back" action
  // out of a conversation, back to the list. No-op visually at `sm` and up,
  // where both panes are already shown together.
  const clearPendingImage = () => {
    setPendingImage((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  };

  // Per-conversation composer/thread UI state that shouldn't carry over when
  // switching or closing a conversation.
  const resetThreadUi = () => {
    setEditingMessageId(null);
    setReplyingTo(null);
    setReactionPickerFor(null);
    setSelectedMessageId(null);
    clearPendingImage();
  };

  const closeActiveConversation = () => {
    if (activeConversation) {
      stopTypingSignal(activeConversation._id);
      getSocket()?.emit('leave_conversation', activeConversation._id);
    }
    setActiveConversation(null);
    setMessages([]);
    setTypingUserIds(new Set());
    resetThreadUi();
  };

  const openConversation = async (conv) => {
    setError('');
    const socket = getSocket();

    if (activeConversation) {
      stopTypingSignal(activeConversation._id);
      socket?.emit('leave_conversation', activeConversation._id);
    }

    setShowCreate(false);
    setActiveConversation(conv);
    setMessages([]);
    setTypingUserIds(new Set());
    setLoadingMessages(true);
    setHasMoreMessages(true);
    setDividerMessageId(null);
    isNearBottomRef.current = true;
    resetThreadUi();

    const unreadAtOpen = conv.unreadCount || 0;
    setConversations((prev) =>
      prev.map((c) => (c._id === conv._id ? { ...c, unreadCount: 0 } : c))
    );

    if (!socket) {
      setError('Not connected to chat server yet. Please wait a moment and try again.');
      setLoadingMessages(false);
      return;
    }

    try {
      // Join the room *before* fetching history: a message sent in the gap
      // between the two can't be in the history we're about to ask for (it
      // hadn't happened yet), and if we joined after fetching we wouldn't be
      // in the room yet to receive it live either — it would simply be lost
      // until the conversation was reopened or the page refreshed.
      const joinAck = await new Promise((resolve) => {
        socket.emit('join_conversation', conv._id, resolve);
      });

      if (!joinAck?.success) {
        setError(joinAck?.message || 'Could not join conversation');
        return;
      }
      setOnlineUserIds((prev) => new Set([...prev, ...(joinAck.onlineMembers || [])]));

      const { data: history } = await axiosInstance.get(
        `/conversations/${conv._id}/messages`,
        { params: { limit: MESSAGES_PAGE_SIZE } }
      );

      // Merge rather than overwrite: a message may have already arrived live
      // (and been appended to `messages`) in the gap while this fetch was in
      // flight. Dedupe by id so it isn't lost or duplicated.
      setMessages((prev) => {
        const historyIds = new Set(history.map((h) => (h.id || h._id)?.toString()));
        const liveExtra = prev.filter((m) => !historyIds.has((m.id || m._id)?.toString()));
        return [...history, ...liveExtra];
      });
      setHasMoreMessages(history.length === MESSAGES_PAGE_SIZE);

      if (unreadAtOpen > 0 && history.length >= unreadAtOpen) {
        const firstUnread = history[history.length - unreadAtOpen];
        setDividerMessageId((firstUnread?.id || firstUnread?._id)?.toString());
      }

      socket.emit('mark_messages_read', conv._id);
    } catch {
      setError('Failed to open conversation. Please try again.');
    } finally {
      setLoadingMessages(false);
    }
  };

  const loadOlderMessages = async () => {
    if (!activeConversation || loadingOlder || !hasMoreMessages || messages.length === 0) return;

    setLoadingOlder(true);
    try {
      const oldest = messages[0];
      const { data: older } = await axiosInstance.get(
        `/conversations/${activeConversation._id}/messages`,
        { params: { limit: MESSAGES_PAGE_SIZE, before: oldest.createdAt } }
      );

      if (older.length < MESSAGES_PAGE_SIZE) setHasMoreMessages(false);

      if (older.length > 0) {
        const el = messagesContainerRef.current;
        prevScrollHeightRef.current = el ? el.scrollHeight : 0;
        setMessages((prev) => [...older, ...prev]);
      }
    } catch {
      // Leave hasMoreMessages as-is; scrolling up again will just retry.
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    setShowScrollButton(distanceFromBottom > 200);

    if (el.scrollTop < 60) loadOlderMessages();
  };

  const scrollToBottom = () => {
    isNearBottomRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const openId = location.state?.openConversationId;
    if (!openId || conversations.length === 0) return;
    const target = conversations.find((c) => c._id === openId);
    if (target) queueMicrotask(() => openConversation(target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, location.state]);

  const startPrivateChat = async (otherUser) => {
    setError('');
    try {
      const { data: conv } = await axiosInstance.post('/conversations', { recipientId: otherUser._id });
      const fullConv = { ...conv, type: 'private', otherUser, lastMessage: null, unreadCount: 0 };
      setConversations((prev) => {
        if (prev.some((c) => c._id === fullConv._id)) return prev;
        return [fullConv, ...prev];
      });
      openConversation(fullConv);
    } catch {
      setError('Failed to start conversation.');
    }
  };

  const toggleGroupMember = (userId) => {
    setGroupMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const createGroup = async () => {
    setError('');
    if (!groupName.trim()) {
      setError('Group name is required');
      return;
    }
    if (groupMemberIds.length < 2) {
      setError('Select at least 2 members');
      return;
    }
    try {
      const { data: conv } = await axiosInstance.post('/conversations', {
        type: 'group',
        name: groupName.trim(),
        memberIds: groupMemberIds,
      });
      const members = [
        { _id: user._id, name: user.name, avatar: user.avatar },
        ...allUsers.filter((u) => groupMemberIds.includes(u._id)),
      ];
      const fullConv = {
        ...conv,
        type: 'group',
        members,
        admins: conv.admins || [user._id],
        lastMessage: null,
        unreadCount: 0,
      };
      // The server's "created the group" event can arrive before this
      // response and already have added the group — replace, don't duplicate.
      setConversations((prev) => {
        const existing = prev.find((c) => c._id === fullConv._id);
        const merged = existing ? { ...fullConv, lastMessage: existing.lastMessage } : fullConv;
        return [merged, ...prev.filter((c) => c._id !== fullConv._id)];
      });
      setGroupName('');
      setGroupMemberIds([]);
      openConversation(fullConv);
    } catch {
      setError('Failed to create group.');
    }
  };

  const handleInputChange = (e) => {
    setMessageInput(e.target.value);
    if (!activeConversation) return;

    const socket = getSocket();
    if (!socket) return;

    if (e.target.value.trim() && !isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit('typing_start', activeConversation._id);
    }

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      stopTypingSignal(activeConversation._id);
    }, TYPING_TIMEOUT_MS);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    setError('');

    if ((!messageInput.trim() && !pendingImage) || !activeConversation || isUploading) return;

    const socket = getSocket();
    if (!socket) {
      setError('Not connected to chat server.');
      return;
    }

    stopTypingSignal(activeConversation._id);

    const conversationId = activeConversation._id;
    const content = messageInput;
    const replyToId = replyingTo ? (replyingTo.id || replyingTo._id).toString() : undefined;

    // Images are uploaded over REST first; the message then just references
    // the stored file by its key.
    let attachmentKey;
    if (pendingImage) {
      setIsUploading(true);
      try {
        const { data } = await axiosInstance.post('/attachments', pendingImage.blob, {
          headers: { 'Content-Type': pendingImage.blob.type },
        });
        attachmentKey = data.key;
      } catch (err) {
        setError(err.response?.data?.message || 'Image upload failed. Please try again.');
        return;
      } finally {
        setIsUploading(false);
      }
    }

    socket.emit('send_message', { conversationId, content, replyTo: replyToId, attachmentKey }, (ack) => {
      if (!ack?.success) setError(ack?.message || 'Failed to send message');
    });
    setMessageInput('');
    setReplyingTo(null);
    clearPendingImage();
    isNearBottomRef.current = true;
  };

  const selectImage = async (file) => {
    if (!file) return;
    setError('');
    try {
      const blob = await prepareImage(file);
      setPendingImage((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return { blob, previewUrl: URL.createObjectURL(blob), name: file.name || 'Pasted image' };
      });
      messageInputRef.current?.focus();
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePaste = (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      selectImage(file);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) selectImage(file);
  };

  const startReply = (msg) => {
    setReplyingTo(msg);
    setEditingMessageId(null);
    setSelectedMessageId(null);
    messageInputRef.current?.focus();
  };

  const toggleReaction = (msg, emoji) => {
    setReactionPickerFor(null);
    setSelectedMessageId(null);
    getSocket()?.emit('react_message', { messageId: (msg.id || msg._id).toString(), emoji }, (ack) => {
      if (!ack?.success) setError(ack?.message || 'Could not add reaction');
    });
  };

  // Jump to the quoted original of a reply (if it's loaded) and flash it.
  const scrollToMessage = (id) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      setError('That message is further up — scroll up to load older messages.');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(id);
    setTimeout(() => setHighlightedMessageId((cur) => (cur === id ? null : cur)), 1600);
  };

  const startEdit = (msg) => {
    setEditingMessageId((msg.id || msg._id).toString());
    setEditContent(msg.content);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const saveEdit = () => {
    if (!editContent.trim()) return;
    const socket = getSocket();
    socket?.emit('edit_message', { messageId: editingMessageId, content: editContent }, (ack) => {
      if (!ack?.success) setError(ack?.message || 'Failed to edit message');
    });
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleDeleteMessage = (msg) => {
    if (!window.confirm('Delete this message?')) return;
    const socket = getSocket();
    socket?.emit('delete_message', { messageId: (msg.id || msg._id).toString() }, (ack) => {
      if (!ack?.success) setError(ack?.message || 'Failed to delete message');
    });
  };

  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const openToastConversation = (toast) => {
    const conv = conversations.find((c) => c._id === toast.conversationId);
    if (conv) openConversation(conv);
    dismissToast(toast.id);
  };

  // Close the emoji picker when clicking anywhere outside it.
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handleClick = (e) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showEmojiPicker]);

  useEffect(() => {
    if (!reactionPickerFor) return;
    const handleClick = (e) => {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target)) {
        setReactionPickerFor(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [reactionPickerFor]);

  // Escape closes the topmost overlay: image viewer, then reaction picker,
  // then the reply preview.
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key !== 'Escape') return;
      if (lightboxUrl) setLightboxUrl(null);
      else if (reactionPickerFor) setReactionPickerFor(null);
      else if (replyingTo) setReplyingTo(null);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [lightboxUrl, reactionPickerFor, replyingTo]);

  // Stop any running dictation when leaving the page.
  useEffect(() => () => recognitionRef.current?.abort(), []);

  // Free the preview's object URL if the page unmounts with an image pending.
  const pendingPreviewUrl = pendingImage?.previewUrl;
  useEffect(() => () => pendingPreviewUrl && URL.revokeObjectURL(pendingPreviewUrl), [pendingPreviewUrl]);

  const applyGroupUpdate = (group) => {
    const patch = { name: group.name, members: group.members, admins: group.admins };
    setConversations((prev) => prev.map((c) => (c._id === group._id ? { ...c, ...patch } : c)));
    setActiveConversation((prev) => (prev?._id === group._id ? { ...prev, ...patch } : prev));
  };

  const handleLeftGroup = (conversationId) => {
    leavingIdsRef.current.add(conversationId);
    setConversations((prev) => prev.filter((c) => c._id !== conversationId));
    if (activeConversation?._id === conversationId) {
      stopTypingSignal(conversationId);
      setActiveConversation(null);
      setMessages([]);
      setTypingUserIds(new Set());
      setShowDetails(false);
      resetThreadUi();
    }
  };

  const toggleFavorite = (conversationId) => {
    setFavoriteIds((prev) => {
      const next = prev.includes(conversationId)
        ? prev.filter((id) => id !== conversationId)
        : [...prev, conversationId];
      try {
        localStorage.setItem(favoritesKey, JSON.stringify(next));
      } catch {
        // Storage full/blocked — the favorite still applies for this session.
      }
      return next;
    });
  };

  const isMobileViewport = () =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

  const openCreatePanel = (mode) => {
    setCreateMode(mode);
    setShowCreate(true);
    setError('');
    // On phones the list is hidden while a conversation is open — go back to
    // it so the create panel is actually visible.
    if (isMobileViewport() && activeConversation) closeActiveConversation();
  };

  const showUnread = () => {
    setActiveTab('unread');
    if (isMobileViewport() && activeConversation) closeActiveConversation();
  };

  const insertEmoji = (emoji) => {
    const input = messageInputRef.current;
    const start = input?.selectionStart ?? messageInput.length;
    const end = input?.selectionEnd ?? messageInput.length;
    const next = (messageInput.slice(0, start) + emoji + messageInput.slice(end)).slice(0, 5000);
    setMessageInput(next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const toggleDictation = () => {
    if (!SpeechRecognitionImpl) return;
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionImpl();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join(' ')
        .trim();
      if (transcript) {
        setMessageInput((prev) => (prev ? `${prev} ${transcript}` : transcript).slice(0, 5000));
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') setError('Microphone access was blocked.');
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const copyMessage = async (msg, msgId) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMessageId(msgId);
      setTimeout(() => setCopiedMessageId((cur) => (cur === msgId ? null : cur)), 1500);
    } catch {
      setError('Could not copy message.');
    }
  };

  const otherUsers = allUsers.filter((u) => u._id !== user._id);

  const filteredOtherUsers = otherUsers.filter((u) =>
    u.name?.toLowerCase().includes(search.toLowerCase())
  );

  const tabFilter = (conv) => {
    switch (activeTab) {
      // Keep the open conversation listed even after opening it zeroes its
      // unread count, so it doesn't vanish from under the user.
      case 'unread':
        return conv.unreadCount > 0 || conv._id === activeConversation?._id;
      case 'favorites':
        return favoriteIds.includes(conv._id);
      case 'private':
      case 'group':
        return conv.type === activeTab;
      default:
        return true;
    }
  };

  const filteredConversations = conversations
    .filter(tabFilter)
    .filter((conv) => conversationLabel(conv)?.toLowerCase().includes(search.toLowerCase()));

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const tabs = [
    { id: 'all', label: 'All messages' },
    { id: 'unread', label: 'Unread', count: conversations.filter((c) => c.unreadCount > 0).length },
    { id: 'favorites', label: 'Favorites' },
    { id: 'private', label: 'Direct' },
    { id: 'group', label: 'Groups' },
  ];

  const emptyListText = () => {
    if (search) return 'No matches found.';
    if (activeTab === 'unread') return "You're all caught up.";
    if (activeTab === 'favorites') return 'No favorites yet. Tap the star in a chat to add one.';
    if (activeTab === 'group') return 'No groups yet.';
    if (activeTab === 'private') return 'No direct chats yet.';
    return 'No conversations yet. Start one above.';
  };

  const nameFor = (userId) => {
    if (activeConversation?.type === 'group') {
      return activeConversation.members?.find((m) => m._id === userId)?.name || 'Someone';
    }
    return activeConversation?.otherUser?.name || 'Someone';
  };

  const avatarFor = (msg) => {
    if (typeof msg.senderId === 'object' && msg.senderId.avatar) return msg.senderId.avatar;
    const senderId = getSenderId(msg);
    if (activeConversation?.type === 'group') {
      return activeConversation.members?.find((m) => m._id === senderId)?.avatar;
    }
    return activeConversation?.otherUser?.avatar;
  };

  const typingText = () => {
    const names = [...typingUserIds].map(nameFor);
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} is typing...`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
    return `${names.length} people are typing...`;
  };

  const presenceLabel = () => {
    if (!activeConversation) return null;
    if (activeConversation.type === 'group') {
      const total = (activeConversation.members || []).length;
      const onlineCount = (activeConversation.members || []).filter((m) =>
        onlineUserIds.has(m._id)
      ).length;
      return `${total} member${total === 1 ? '' : 's'} · ${onlineCount} online`;
    }
    const isOnline = onlineUserIds.has(activeConversation.otherUser?._id);
    return isOnline ? 'Online' : 'Offline';
  };

  const getMessageStatus = (msg) => {
    const readBy = msg.readBy || [];
    const deliveredTo = msg.deliveredTo || [];

    if (activeConversation?.type === 'group') {
      const otherIds = (activeConversation.members || [])
        .map((m) => m._id)
        .filter((id) => id !== user._id);
      if (otherIds.length === 0) return 'sent';
      if (otherIds.every((id) => readBy.includes(id))) return 'read';
      if (otherIds.every((id) => deliveredTo.includes(id))) return 'delivered';
      return 'sent';
    }

    const otherId = activeConversation?.otherUser?._id;
    if (!otherId) return 'sent';
    if (readBy.includes(otherId)) return 'read';
    if (deliveredTo.includes(otherId)) return 'delivered';
    return 'sent';
  };

  const roundIconButton =
    'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors';

  const isFavorite = activeConversation && favoriteIds.includes(activeConversation._id);
  const typing = typingText();

  const idOf = (msg) => (msg.id || msg._id)?.toString();
  const userIdOf = (ref) => (ref && typeof ref === 'object' ? ref._id : ref)?.toString();
  const displayName = (ref) => {
    const id = userIdOf(ref);
    if (id === user._id) return 'You';
    return (ref && typeof ref === 'object' && ref.name) || nameFor(id);
  };

  const actionButton =
    'p-1.5 rounded-full text-muted hover:bg-surface dark:hover:bg-surface-dark transition-colors';

  const ReplyIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 14 4 9l5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );

  const ReactIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20.5 11.5A8.5 8.5 0 1 1 12.5 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.5 14s1.2 2 3.5 2 3.5-2 3.5-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="9" cy="10" r="1.1" fill="currentColor" />
      <circle cx="15" cy="10" r="1.1" fill="currentColor" />
      <path d="M19 2v5M16.5 4.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );

  const renderReactButton = (msg) => {
    const id = idOf(msg);
    return (
      <button
        type="button"
        // Keep the picker's outside-click handler from closing it and this
        // click immediately reopening it.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setReactionPickerFor((cur) => (cur === id ? null : id));
        }}
        aria-label="React to message"
        aria-expanded={reactionPickerFor === id}
        title="React"
        className={`${actionButton} hover:text-accent ${reactionPickerFor === id ? 'text-accent' : ''}`}
      >
        {ReactIcon}
      </button>
    );
  };

  const renderReplyButton = (msg) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        startReply(msg);
      }}
      aria-label="Reply to message"
      title="Reply"
      className={`${actionButton} hover:text-accent`}
    >
      {ReplyIcon}
    </button>
  );

  const renderReactionPicker = (msg, isMine) =>
    reactionPickerFor === idOf(msg) && (
      <div
        ref={reactionPickerRef}
        role="menu"
        aria-label="Pick a reaction"
        className={`absolute bottom-full mb-1.5 z-30 flex gap-0.5 p-1 rounded-full bg-surface dark:bg-surface-dark border border-line dark:border-line-dark shadow-xl ${
          isMine ? 'right-0' : 'left-0'
        }`}
      >
        {REACTIONS.map((emoji) => {
          const mine = (msg.reactions || []).some((r) => r.emoji === emoji && String(r.userId) === user._id);
          return (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                toggleReaction(msg, emoji);
              }}
              aria-label={`React with ${emoji}`}
              className={`w-9 h-9 rounded-full text-xl leading-none transition-transform hover:scale-125 ${
                mine ? 'bg-accent-soft dark:bg-accent-soft-dark' : 'hover:bg-nav-active dark:hover:bg-nav-active-dark'
              }`}
            >
              {emoji}
            </button>
          );
        })}
      </div>
    );

  const renderReactions = (msg, isMine) => {
    const reactions = msg.reactions || [];
    if (msg.isDeleted || reactions.length === 0) return null;
    const groups = REACTIONS.map((emoji) => ({
      emoji,
      userIds: reactions.filter((r) => r.emoji === emoji).map((r) => String(r.userId)),
    })).filter((g) => g.userIds.length > 0);

    return (
      <div className={`flex flex-wrap gap-1 -mt-2.5 relative z-10 ${isMine ? 'justify-end pr-2' : 'pl-2'}`}>
        {groups.map((g) => {
          const reactedByMe = g.userIds.includes(user._id);
          return (
            <button
              key={g.emoji}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleReaction(msg, g.emoji);
              }}
              title={g.userIds.map((id) => displayName(id)).join(', ')}
              aria-label={`${g.emoji} ${g.userIds.length}${reactedByMe ? ', including you' : ''}`}
              className={`flex items-center gap-1 h-6 px-1.5 rounded-full text-xs border shadow-sm transition-colors ${
                reactedByMe
                  ? 'bg-accent-soft dark:bg-accent-soft-dark border-accent/40 text-accent'
                  : 'bg-surface dark:bg-surface-dark border-line dark:border-line-dark text-muted'
              }`}
            >
              <span className="text-sm leading-none">{g.emoji}</span>
              {g.userIds.length > 1 && <span className="font-semibold">{g.userIds.length}</span>}
            </button>
          );
        })}
      </div>
    );
  };

  const renderQuote = (msg, isMine) => {
    const quote = msg.replyTo;
    if (!quote || msg.isDeleted) return null;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          scrollToMessage(quote._id);
        }}
        title="Go to original message"
        className={`block w-full min-w-32 text-left mb-1.5 px-2.5 py-1.5 rounded-lg border-l-[3px] border-accent hover:opacity-90 ${
          isMine ? 'bg-thread dark:bg-thread-dark' : 'bg-white/70 dark:bg-black/20'
        }`}
      >
        <span className="block text-[11px] font-semibold text-accent truncate">{displayName(quote.senderId)}</span>
        <span className={`block text-xs text-muted line-clamp-2 break-words ${quote.isDeleted ? 'italic' : ''}`}>
          {previewText(quote)}
        </span>
      </button>
    );
  };

  const renderBubbleBody = (msg, isMine) => {
    const hasImage = msg.messageType === 'image' && msg.attachment?.key && !msg.isDeleted;
    return (
      <>
        {renderQuote(msg, isMine)}
        {hasImage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxUrl(attachmentUrl(msg.attachment.key));
            }}
            aria-label="Open photo"
            className="block cursor-zoom-in"
          >
            <img
              src={attachmentUrl(msg.attachment.key)}
              alt={msg.content || 'Photo'}
              loading="lazy"
              // The image's height isn't known until it loads; keep the
              // thread pinned to the bottom if that's where the user was.
              onLoad={() => {
                if (isNearBottomRef.current) messagesEndRef.current?.scrollIntoView();
              }}
              className="block rounded-xl max-h-72 max-w-full sm:max-w-xs min-w-24 min-h-24 object-cover bg-black/5 dark:bg-white/5"
            />
          </button>
        )}
        {msg.content && (
          <span className={`block whitespace-pre-wrap break-words ${hasImage ? 'px-2 pt-1.5 pb-0.5' : ''}`}>
            {msg.content}
          </span>
        )}
      </>
    );
  };

  return (
    <DashboardLayout
      fullHeight
      search={search}
      onSearchChange={setSearch}
      unreadCount={totalUnread}
      onNotificationsClick={showUnread}
    >
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => openToastConversation(t)}
            className="text-left bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-2xl shadow-xl p-3.5 pl-4 relative flex items-start gap-3"
          >
            <span className="w-8 h-8 rounded-full bg-linear-to-br from-accent-light to-accent text-white flex items-center justify-center flex-shrink-0">
              <ChatIcon size={16} strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink dark:text-ink-dark pr-4">{t.title}</span>
              {t.body && <span className="block text-xs text-muted mt-0.5 truncate">{t.body}</span>}
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(t.id);
              }}
              role="button"
              tabIndex={0}
              aria-label="Dismiss notification"
              className="absolute top-2.5 right-3 text-muted text-xs"
            >
              ✕
            </span>
          </button>
        ))}
      </div>

      <div className="flex h-full gap-3 md:gap-4">
        {/* ───────────── Conversation list card ───────────── */}
        <aside
          className={`w-full sm:w-80 lg:w-[22rem] flex-shrink-0 bg-surface dark:bg-surface-dark rounded-2xl shadow-sm overflow-hidden flex-col sm:flex ${
            activeConversation ? 'hidden' : 'flex'
          }`}
        >
          <div className="px-5 pt-5 pb-2 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-ink dark:text-ink-dark">Messages</h2>
            <button
              onClick={() => setShowListSearch((v) => !v)}
              aria-label="Search conversations"
              aria-pressed={showListSearch}
              className={`${roundIconButton} w-8 h-8 ${
                showListSearch || search
                  ? 'bg-accent-soft dark:bg-accent-soft-dark text-accent'
                  : 'text-ink dark:text-ink-dark hover:bg-nav-active dark:hover:bg-nav-active-dark'
              }`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {(showListSearch || search) && (
            <div className="px-5 pb-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search people or groups"
                aria-label="Search conversations"
                autoFocus={showListSearch}
                className="w-full px-4 py-2 rounded-full bg-nav-active dark:bg-nav-active-dark text-ink dark:text-ink-dark text-sm outline-none border border-transparent focus:border-accent/50 transition-colors placeholder:text-muted"
              />
            </div>
          )}

          <div className="px-5 flex items-center gap-4 border-b border-line dark:border-line-dark overflow-x-auto no-scrollbar">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative py-2 text-[13px] whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'text-accent font-semibold'
                    : 'text-muted hover:text-ink dark:hover:text-ink-dark'
                }`}
              >
                {tab.label}
                {tab.count > 0 && <span className="ml-1 text-[11px]">({tab.count})</span>}
                {activeTab === tab.id && (
                  <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full bg-accent" />
                )}
              </button>
            ))}
          </div>

          {socketStatus !== 'connected' && (
            <div
              className={`mx-5 mt-3 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                socketStatus === 'error'
                  ? 'bg-danger-soft text-danger'
                  : 'bg-accent-soft dark:bg-accent-soft-dark text-accent'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  socketStatus === 'error' ? 'bg-danger' : 'bg-accent animate-pulse'
                }`}
                aria-hidden="true"
              />
              {socketStatus === 'connecting' && 'Connecting...'}
              {socketStatus === 'reconnecting' && 'Reconnecting...'}
              {socketStatus === 'disconnected' && 'Offline — trying to reconnect...'}
              {socketStatus === 'error' && 'Connection error'}
            </div>
          )}

          <div className="px-5 pt-3 pb-2">
            <button
              onClick={() => (showCreate ? setShowCreate(false) : openCreatePanel('private'))}
              aria-expanded={showCreate}
              className="w-full py-2.5 rounded-xl bg-linear-to-r from-accent-light to-accent text-white text-sm font-semibold shadow-md shadow-accent/20 hover:brightness-105 active:brightness-95 transition flex items-center justify-center gap-2"
            >
              {showCreate ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14z" />
                </svg>
              )}
              {showCreate ? 'Close' : 'Start a new conversation'}
            </button>
          </div>

          {showCreate && (
            <div className="mx-5 mb-2 rounded-xl border border-line dark:border-line-dark overflow-hidden">
              <div className="flex p-1 m-2 bg-nav-active dark:bg-nav-active-dark rounded-lg">
                {[
                  { id: 'private', label: 'Direct chat' },
                  { id: 'group', label: 'New group' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setCreateMode(mode.id)}
                    className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      createMode === mode.id
                        ? 'bg-surface dark:bg-surface-dark text-accent shadow-sm'
                        : 'text-muted'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {!activeConversation && error && (
                <div className="mx-2 mb-2 bg-danger-soft text-danger rounded-lg px-3 py-2 text-xs">{error}</div>
              )}

              {createMode === 'private' && (
                <div className="max-h-60 overflow-y-auto scroll-thin pb-1">
                  {filteredOtherUsers.length === 0 && (
                    <p className="text-sm text-muted text-center py-4">No users found.</p>
                  )}
                  {filteredOtherUsers.map((u) => (
                    <button
                      key={u._id}
                      onClick={() => startPrivateChat(u)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-ink dark:text-ink-dark hover:bg-nav-active dark:hover:bg-nav-active-dark"
                    >
                      <Avatar
                        name={u.name}
                        src={u.avatar}
                        size="w-8 h-8"
                        textSize="text-xs"
                        online={onlineUserIds.has(u._id)}
                      />
                      <span className="truncate">{u.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {createMode === 'group' && (
                <div className="px-2 pb-2 flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="Group name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-line dark:border-line-dark bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none focus:border-accent"
                  />
                  <p className="text-[11px] text-muted px-1">
                    Select at least 2 members · {groupMemberIds.length} selected
                  </p>
                  <div className="flex flex-col max-h-40 overflow-y-auto scroll-thin">
                    {filteredOtherUsers.map((u) => (
                      <label
                        key={u._id}
                        className="flex items-center gap-2.5 text-sm text-ink dark:text-ink-dark px-1.5 py-1.5 rounded-lg hover:bg-nav-active dark:hover:bg-nav-active-dark cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={groupMemberIds.includes(u._id)}
                          onChange={() => toggleGroupMember(u._id)}
                          className="accent-accent"
                        />
                        <Avatar name={u.name} src={u.avatar} size="w-7 h-7" textSize="text-[10px]" />
                        <span className="truncate">{u.name}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={createGroup}
                    className="py-2 rounded-lg bg-ink dark:bg-ink-dark text-white dark:text-ink text-sm font-semibold hover:opacity-90"
                  >
                    Create group
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto scroll-thin">
            {loadingConversations && (
              <p className="text-sm text-muted text-center py-6">Loading...</p>
            )}
            {!loadingConversations && filteredConversations.length === 0 && (
              <p className="text-sm text-muted text-center py-8 px-6">{emptyListText()}</p>
            )}
            {filteredConversations.map((conv) => {
              const isOnline =
                conv.type === 'private' ? onlineUserIds.has(conv.otherUser?._id) : undefined;
              const isActive = activeConversation?._id === conv._id;

              return (
                <button
                  key={conv._id}
                  onClick={() => openConversation(conv)}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left border-b border-line dark:border-line-dark transition-colors ${
                    isActive
                      ? 'bg-nav-active dark:bg-nav-active-dark'
                      : 'hover:bg-nav-active/60 dark:hover:bg-nav-active-dark/60'
                  }`}
                >
                  <Avatar
                    name={conversationLabel(conv)}
                    src={conv.type === 'private' ? conv.otherUser?.avatar : undefined}
                    online={isOnline}
                    group={conv.type === 'group'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink dark:text-ink-dark truncate flex items-center gap-1">
                        <span className="truncate">{conversationLabel(conv)}</span>
                        {favoriteIds.includes(conv._id) && (
                          <svg width="12" height="12" viewBox="0 0 24 24" className="text-accent flex-shrink-0" fill="currentColor" aria-label="Favorite">
                            <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />
                          </svg>
                        )}
                      </p>
                      {conv.lastMessage && (
                        <span className="text-[11px] text-muted flex-shrink-0">
                          {listTime(conv.lastMessage.createdAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p
                        className={`text-xs truncate ${
                          conv.unreadCount > 0 ? 'text-ink dark:text-ink-dark font-medium' : 'text-muted'
                        }`}
                      >
                        {conv.lastMessage
                          ? previewText(conv.lastMessage)
                          : conv.type === 'group'
                            ? `${(conv.members || []).length} member${(conv.members || []).length === 1 ? '' : 's'}`
                            : 'No messages yet'}
                      </p>
                      {conv.unreadCount > 0 && (
                        <span
                          className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center flex-shrink-0"
                          aria-label={`${conv.unreadCount} unread messages`}
                        >
                          {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ───────────── Chat card ───────────── */}
        <section
          className={`flex-1 min-w-0 bg-surface dark:bg-surface-dark rounded-2xl shadow-sm overflow-hidden relative flex-col sm:flex ${
            activeConversation ? 'flex' : 'hidden'
          }`}
        >
          {!activeConversation ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 bg-thread dark:bg-thread-dark">
              <span className="w-14 h-14 rounded-2xl bg-linear-to-br from-accent-light to-accent text-white flex items-center justify-center shadow-lg shadow-accent/25 mb-4">
                <ChatIcon size={28} strokeWidth={1.9} />
              </span>
              <h3 className="text-base font-semibold text-ink dark:text-ink-dark">Your messages</h3>
              <p className="text-sm text-muted mt-1 max-w-xs">
                Select a conversation from the list, or start a new chat or group.
              </p>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => openCreatePanel('private')}
                  className="px-4 py-2 rounded-full bg-ink dark:bg-ink-dark text-white dark:text-ink text-sm font-semibold hover:opacity-90"
                >
                  New chat
                </button>
                <button
                  onClick={() => openCreatePanel('group')}
                  className="px-4 py-2 rounded-full border border-line dark:border-line-dark text-ink dark:text-ink-dark text-sm font-semibold hover:bg-nav-active dark:hover:bg-nav-active-dark"
                >
                  New group
                </button>
              </div>
            </div>
          ) : (
            <>
              <header className="flex items-center justify-between gap-3 px-4 md:px-5 py-3.5 border-b border-line dark:border-line-dark">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={closeActiveConversation}
                    aria-label="Back to conversations"
                    className="sm:hidden -ml-1 p-1 text-ink dark:text-ink-dark flex-shrink-0"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <Avatar
                    name={conversationLabel(activeConversation)}
                    src={activeConversation.type === 'private' ? activeConversation.otherUser?.avatar : undefined}
                    size="w-9 h-9"
                    textSize="text-xs"
                    group={activeConversation.type === 'group'}
                    online={
                      activeConversation.type === 'private'
                        ? onlineUserIds.has(activeConversation.otherUser?._id)
                        : undefined
                    }
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-[15px] text-ink dark:text-ink-dark truncate">
                      {conversationLabel(activeConversation)}
                    </p>
                    <p className={`text-xs truncate ${typing ? 'text-accent' : 'text-muted'}`}>
                      {typing || presenceLabel()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => openCreatePanel('group')}
                    className="hidden md:flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-ink dark:bg-ink-dark text-white dark:text-ink text-xs font-semibold hover:opacity-90"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
                    </svg>
                    New group
                  </button>
                  <button
                    onClick={() => toggleFavorite(activeConversation._id)}
                    aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-pressed={isFavorite}
                    title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    className={`${roundIconButton} border border-line dark:border-line-dark ${
                      isFavorite ? 'text-accent' : 'text-ink dark:text-ink-dark hover:bg-nav-active dark:hover:bg-nav-active-dark'
                    }`}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true">
                      <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setShowDetails((v) => !v)}
                    aria-label="Conversation details"
                    aria-pressed={showDetails}
                    title="Details"
                    className={`${roundIconButton} border border-line dark:border-line-dark ${
                      showDetails
                        ? 'bg-accent-soft dark:bg-accent-soft-dark text-accent'
                        : 'text-ink dark:text-ink-dark hover:bg-nav-active dark:hover:bg-nav-active-dark'
                    }`}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      <circle cx="16" cy="7" r="2" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="8" cy="17" r="2" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  </button>
                </div>
              </header>

              <div
                className="flex-1 min-h-0 flex relative"
                onDragOver={(e) => {
                  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false);
                }}
                onDrop={handleDrop}
              >
                {isDragging && (
                  <div className="absolute inset-2 z-30 rounded-2xl border-2 border-dashed border-accent bg-accent-soft/90 dark:bg-accent-soft-dark/90 flex items-center justify-center pointer-events-none">
                    <p className="text-sm font-semibold text-accent">Drop the image to send it</p>
                  </div>
                )}
                <div
                  ref={messagesContainerRef}
                  onScroll={handleScroll}
                  className="flex-1 min-w-0 overflow-y-auto scroll-thin px-4 md:px-6 py-4 flex flex-col gap-3 bg-thread dark:bg-thread-dark"
                >
                  {loadingOlder && (
                    <p className="text-xs text-muted text-center py-1">Loading older messages...</p>
                  )}
                  {loadingMessages && (
                    <p className="text-sm text-muted text-center">Loading messages...</p>
                  )}
                  {!loadingMessages && messages.length === 0 && (
                    <p className="text-sm text-muted text-center mt-8">
                      No messages yet. Say hello! 👋
                    </p>
                  )}
                  {messages.map((msg, index) => {
                    const msgId = idOf(msg);
                    const senderId = getSenderId(msg);
                    const isMine = senderId === user._id;
                    const isSystem = msg.messageType === 'system';
                    const senderName =
                      typeof msg.senderId === 'object' ? msg.senderId.name : nameFor(senderId);
                    const status = isMine && !isSystem ? getMessageStatus(msg) : null;
                    const isEditing = editingMessageId === msgId;
                    const isSelected = selectedMessageId === msgId;
                    const hasImage = msg.messageType === 'image' && msg.attachment?.key && !msg.isDeleted;
                    const createdAt = new Date(msg.createdAt);
                    const prev = messages[index - 1];
                    const showDay = !prev || !isSameDay(new Date(prev.createdAt), createdAt);
                    const highlight =
                      highlightedMessageId === msgId
                        ? 'ring-2 ring-accent ring-offset-2 ring-offset-thread dark:ring-offset-thread-dark'
                        : '';
                    // Tapping a bubble reveals its actions on touch screens
                    // (desktop shows them on hover).
                    const toggleSelected = () => setSelectedMessageId((cur) => (cur === msgId ? null : msgId));

                    return (
                      <Fragment key={msgId}>
                        {showDay && (
                          <div className="text-center text-xs text-muted my-1" aria-hidden="true">
                            {dayLabel(createdAt)} {timeOf(createdAt)}
                          </div>
                        )}
                        {dividerMessageId === msgId && (
                          <div className="flex items-center gap-2 my-1" aria-hidden="true">
                            <div className="flex-1 h-px bg-accent/30" />
                            <span className="text-[11px] font-medium text-accent whitespace-nowrap">New messages</span>
                            <div className="flex-1 h-px bg-accent/30" />
                          </div>
                        )}

                        {isSystem ? (
                          <div
                            id={`msg-${msgId}`}
                            className="self-center max-w-[90%] text-center text-[11px] text-muted bg-surface/80 dark:bg-surface-dark/80 border border-line dark:border-line-dark px-3 py-1 rounded-full"
                          >
                            {msg.content}
                          </div>
                        ) : isMine ? (
                          <div
                            id={`msg-${msgId}`}
                            className="self-end flex items-center gap-1.5 max-w-[88%] sm:max-w-[75%] group"
                          >
                            {!msg.isDeleted && !isEditing && (
                              <div className={`${isSelected ? 'flex' : 'hidden'} md:flex items-center gap-0.5`}>
                                <span
                                  className={`flex items-center gap-0.5 transition-opacity ${
                                    reactionPickerFor === msgId
                                      ? 'opacity-100'
                                      : 'md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100'
                                  }`}
                                >
                                  {renderReplyButton(msg)}
                                  {renderReactButton(msg)}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteMessage(msg);
                                    }}
                                    aria-label="Delete message"
                                    title="Delete"
                                    className={`${actionButton} hover:text-danger`}
                                  >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  </button>
                                </span>
                                {!hasImage && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startEdit(msg);
                                    }}
                                    aria-label="Edit message"
                                    title="Edit"
                                    className={`${actionButton} hover:text-accent md:opacity-60 md:group-hover:opacity-100`}
                                  >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                                      <path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.8" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            )}
                            <div
                              onClick={toggleSelected}
                              className={`relative flex flex-col items-end gap-1 min-w-0 ${isEditing ? 'w-72 max-w-full' : ''}`}
                            >
                              {renderReactionPicker(msg, true)}
                              {isEditing ? (
                                <div className="w-full bg-surface dark:bg-surface-dark rounded-2xl shadow-sm p-2 flex flex-col gap-1.5">
                                  <input
                                    type="text"
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                    maxLength={5000}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveEdit();
                                      if (e.key === 'Escape') cancelEdit();
                                    }}
                                    autoFocus
                                    aria-label="Edit message"
                                    className="w-full px-3 py-2 rounded-xl border border-accent bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none"
                                  />
                                  <div className="flex justify-end gap-3 px-1">
                                    <button onClick={cancelEdit} aria-label="Cancel edit" className="text-xs text-muted">
                                      Cancel
                                    </button>
                                    <button onClick={saveEdit} aria-label="Save edit" className="text-xs text-accent font-semibold">
                                      Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  className={`rounded-2xl rounded-tr-md text-sm leading-relaxed break-words transition-shadow ${highlight} ${
                                    hasImage ? 'p-1.5' : 'px-4 py-2.5'
                                  } ${
                                    msg.isDeleted
                                      ? 'italic text-muted border border-line dark:border-line-dark'
                                      : 'bg-surface dark:bg-surface-dark text-ink dark:text-ink-dark shadow-sm'
                                  }`}
                                >
                                  {renderBubbleBody(msg, true)}
                                </div>
                              )}
                              {renderReactions(msg, true)}
                              <div className="flex items-center gap-1 px-1">
                                <span className="text-[11px] text-muted">{timeOf(createdAt)}</span>
                                {msg.edited && !msg.isDeleted && (
                                  <span className="text-[11px] text-muted italic">(edited)</span>
                                )}
                                {!msg.isDeleted && (
                                  <span
                                    className={`text-[11px] ${status === 'read' ? 'text-accent' : 'text-muted'}`}
                                    title={status}
                                  >
                                    {status === 'sent' ? '✓' : '✓✓'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div
                            id={`msg-${msgId}`}
                            className="self-start flex items-start gap-2.5 max-w-[88%] sm:max-w-[75%]"
                          >
                            <Avatar
                              name={senderName}
                              src={avatarFor(msg)}
                              size="w-8 h-8"
                              textSize="text-[11px]"
                            />
                            <div className="relative flex flex-col items-start gap-1 min-w-0">
                              {activeConversation.type === 'group' && (
                                <span className="text-[11px] font-medium text-muted px-1">{senderName}</span>
                              )}
                              {renderReactionPicker(msg, false)}
                              <div
                                className={`rounded-2xl rounded-tl-md text-sm leading-relaxed break-words transition-shadow ${highlight} ${
                                  hasImage ? 'p-1.5' : 'px-4 py-2.5'
                                } ${
                                  msg.isDeleted
                                    ? 'italic text-muted border border-line dark:border-line-dark'
                                    : 'bg-accent-soft dark:bg-accent-soft-dark text-ink dark:text-ink-dark'
                                }`}
                              >
                                {renderBubbleBody(msg, false)}
                              </div>
                              {renderReactions(msg, false)}
                              <div className="flex items-center gap-0.5 px-1">
                                <span className="text-[11px] text-muted mr-1">{timeOf(createdAt)}</span>
                                {msg.edited && !msg.isDeleted && (
                                  <span className="text-[11px] text-muted italic mr-1">(edited)</span>
                                )}
                                {!msg.isDeleted && (
                                  <>
                                    {renderReplyButton(msg)}
                                    {renderReactButton(msg)}
                                    {msg.content && (
                                      <button
                                        onClick={() => copyMessage(msg, msgId)}
                                        aria-label="Copy message"
                                        title={copiedMessageId === msgId ? 'Copied!' : 'Copy'}
                                        className={`${actionButton} hover:text-ink dark:hover:text-ink-dark`}
                                      >
                                        {copiedMessageId === msgId ? (
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path d="m5 12 5 5L20 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                          </svg>
                                        ) : (
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
                                            <path d="M5 15V6a2 2 0 0 1 2-2h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                          </svg>
                                        )}
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </Fragment>
                    );
                  })}

                  {typing && (
                    <div className="self-start flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-accent-soft dark:bg-accent-soft-dark">
                      <span className="flex gap-1" aria-hidden="true">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" />
                      </span>
                      <span className="text-xs text-muted italic">{typing}</span>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {showDetails && (
                  <aside className="absolute inset-0 lg:static lg:inset-auto z-20 lg:z-auto w-full lg:w-72 flex-shrink-0 bg-surface dark:bg-surface-dark lg:border-l border-line dark:border-line-dark flex flex-col overflow-y-auto scroll-thin">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-line dark:border-line-dark">
                      <h3 className="text-sm font-semibold text-ink dark:text-ink-dark">Details</h3>
                      <button
                        onClick={() => setShowDetails(false)}
                        aria-label="Close details"
                        className="p-1 rounded-md text-muted hover:text-ink dark:hover:text-ink-dark"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex flex-col items-center text-center px-5 py-6 border-b border-line dark:border-line-dark">
                      <Avatar
                        name={conversationLabel(activeConversation)}
                        src={activeConversation.type === 'private' ? activeConversation.otherUser?.avatar : undefined}
                        size="w-16 h-16"
                        textSize="text-lg"
                        group={activeConversation.type === 'group'}
                      />
                      <p className="mt-3 font-semibold text-ink dark:text-ink-dark">
                        {conversationLabel(activeConversation)}
                      </p>
                      <p className="text-xs text-muted mt-0.5">{presenceLabel()}</p>
                      <button
                        onClick={() => toggleFavorite(activeConversation._id)}
                        className="mt-3 text-xs font-semibold text-accent hover:underline"
                      >
                        {isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      </button>
                    </div>
                    {activeConversation.type === 'group' && (
                      <GroupDetails
                        key={activeConversation._id}
                        conversation={activeConversation}
                        currentUserId={user._id}
                        onlineUserIds={onlineUserIds}
                        allUsers={allUsers}
                        onUpdated={applyGroupUpdate}
                        onLeaveStart={(id) => leavingIdsRef.current.add(id)}
                        onLeft={handleLeftGroup}
                        onError={setError}
                      />
                    )}
                  </aside>
                )}

                {showScrollButton && (
                  <button
                    onClick={scrollToBottom}
                    aria-label="Scroll to latest messages"
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-surface dark:bg-surface-dark border border-line dark:border-line-dark shadow-lg flex items-center justify-center text-ink dark:text-ink-dark"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>

              {error && (
                <div className="mx-4 md:mx-5 mt-2 bg-danger-soft text-danger rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-2">
                  <span>{error}</span>
                  <button onClick={() => setError('')} aria-label="Dismiss error" className="flex-shrink-0">
                    ✕
                  </button>
                </div>
              )}

              {(replyingTo || pendingImage) && (
                <div className="mx-3 md:mx-5 mt-2 flex flex-col gap-2">
                  {replyingTo && (
                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-nav-active dark:bg-nav-active-dark border-l-[3px] border-accent">
                      <span className="text-accent flex-shrink-0">{ReplyIcon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-accent truncate">
                          Replying to {displayName(replyingTo.senderId)}
                        </p>
                        <p className="text-xs text-muted truncate">{previewText(replyingTo)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyingTo(null)}
                        aria-label="Cancel reply"
                        className="p-1 text-muted hover:text-ink dark:hover:text-ink-dark flex-shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  {pendingImage && (
                    <div className="flex items-center gap-3 p-2 pr-3 rounded-xl bg-nav-active dark:bg-nav-active-dark">
                      <img
                        src={pendingImage.previewUrl}
                        alt="Selected image preview"
                        className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-ink dark:text-ink-dark truncate">{pendingImage.name}</p>
                        <p className="text-[11px] text-muted">
                          {isUploading
                            ? 'Uploading...'
                            : `${(pendingImage.blob.size / 1024).toFixed(0)} KB · add a caption or press send`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={clearPendingImage}
                        disabled={isUploading}
                        aria-label="Remove image"
                        className="p-1 text-muted hover:text-ink dark:hover:text-ink-dark flex-shrink-0 disabled:opacity-40"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              )}

              <form
                onSubmit={handleSend}
                className="flex items-center gap-2 px-3 md:px-5 py-3 border-t border-line dark:border-line-dark mt-2"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    selectImage(e.target.files?.[0]);
                    // Allow picking the same file again after removing it.
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  aria-label="Send a photo"
                  title="Send a photo"
                  className={`${roundIconButton} w-10 h-10 ${
                    pendingImage
                      ? 'bg-accent-soft dark:bg-accent-soft-dark text-accent'
                      : 'bg-nav-active dark:bg-nav-active-dark text-ink dark:text-ink-dark hover:text-accent'
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
                    <circle cx="9" cy="10" r="1.8" fill="currentColor" />
                    <path d="m4 18 5-5 3.5 3.5L16 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  </svg>
                </button>

                <div ref={emojiPickerRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker((v) => !v)}
                    aria-label="Insert emoji"
                    aria-expanded={showEmojiPicker}
                    className={`${roundIconButton} w-10 h-10 ${
                      showEmojiPicker
                        ? 'bg-accent-soft dark:bg-accent-soft-dark text-accent'
                        : 'bg-nav-active dark:bg-nav-active-dark text-ink dark:text-ink-dark hover:text-accent'
                    }`}
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M8.5 14.5s1.2 2 3.5 2 3.5-2 3.5-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      <circle cx="9" cy="10" r="1.1" fill="currentColor" />
                      <circle cx="15" cy="10" r="1.1" fill="currentColor" />
                    </svg>
                  </button>
                  {showEmojiPicker && (
                    <div className="absolute bottom-12 left-0 z-30 w-64 p-2 grid grid-cols-8 gap-0.5 bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-2xl shadow-xl">
                      {EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          className="h-8 rounded-lg text-lg hover:bg-nav-active dark:hover:bg-nav-active-dark"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {SpeechRecognitionImpl && (
                  <button
                    type="button"
                    onClick={toggleDictation}
                    aria-label={isListening ? 'Stop voice typing' : 'Voice typing'}
                    aria-pressed={isListening}
                    title={isListening ? 'Listening... click to stop' : 'Voice typing'}
                    className={`${roundIconButton} w-10 h-10 ${
                      isListening
                        ? 'bg-danger text-white animate-pulse'
                        : 'bg-nav-active dark:bg-nav-active-dark text-ink dark:text-ink-dark hover:text-accent'
                    }`}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                )}

                <input
                  ref={messageInputRef}
                  type="text"
                  value={messageInput}
                  onChange={handleInputChange}
                  onPaste={handlePaste}
                  placeholder={
                    isListening ? 'Listening...' : pendingImage ? 'Add a caption...' : 'Type a message...'
                  }
                  aria-label="Message"
                  maxLength={5000}
                  className="flex-1 min-w-0 px-4 py-2.5 rounded-full bg-nav-active dark:bg-nav-active-dark text-ink dark:text-ink-dark text-sm outline-none border border-transparent focus:border-accent/50 transition-colors placeholder:text-muted"
                />
                <button
                  type="submit"
                  disabled={(!messageInput.trim() && !pendingImage) || isUploading}
                  aria-label="Send message"
                  className={`${roundIconButton} w-10 h-10 bg-linear-to-br from-accent-light to-accent text-white shadow-md shadow-accent/25 hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
                >
                  {isUploading ? (
                    <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" />
                    </svg>
                  )}
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img
            src={lightboxUrl}
            alt="Full size"
            onClick={(e) => e.stopPropagation()}
            className="max-w-[94vw] max-h-[88vh] rounded-lg shadow-2xl object-contain cursor-default"
          />
          <div className="absolute top-4 right-4 flex gap-2">
            <a
              href={lightboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="px-3 py-2 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-semibold"
            >
              Open original
            </a>
            <button
              type="button"
              onClick={() => setLightboxUrl(null)}
              aria-label="Close photo"
              className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

export default Chat;

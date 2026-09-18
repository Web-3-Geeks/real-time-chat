import { useState, useEffect, useRef, Fragment } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import axiosInstance from '../api/axiosInstance';
import { getSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';

const getSenderId = (msg) => (typeof msg.senderId === 'object' ? msg.senderId._id : msg.senderId);

const conversationLabel = (conv) => (conv.type === 'group' ? conv.name : conv.otherUser?.name || 'Unknown');

const conversationInitial = (conv) => conversationLabel(conv)?.[0]?.toUpperCase() || '?';

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
  const [activeTab, setActiveTab] = useState('private'); // 'private' | 'group'
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState([]);
  const [search, setSearch] = useState('');

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const activeConversationRef = useRef(null);
  const conversationsRef = useRef([]);
  const isNearBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);

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

      setToasts((prev) => {
        if (prev.some((t) => t.id === toastId)) return prev;
        return [
          ...prev,
          {
            id: toastId,
            conversationId: msg.conversationId,
            title: `${senderName} sent you a message`,
            body: msg.content,
          },
        ];
      });
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, 5000);

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const notification = new Notification(`${senderName} sent you a message`, {
          body: msg.content,
        });
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
            lastMessage: { content: msg.content, createdAt: msg.createdAt },
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

    const handleEdited = (updated) => {
      setMessages((prev) =>
        prev.map((m) =>
          (m.id || m._id)?.toString() === updated.id
            ? { ...m, content: updated.content, edited: true, editedAt: updated.editedAt }
            : m
        )
      );
    };

    const handleDeleted = (updated) => {
      setMessages((prev) =>
        prev.map((m) =>
          (m.id || m._id)?.toString() === updated.id
            ? { ...m, content: updated.content, isDeleted: true }
            : m
        )
      );
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
  const closeActiveConversation = () => {
    if (activeConversation) {
      stopTypingSignal(activeConversation._id);
      getSocket()?.emit('leave_conversation', activeConversation._id);
    }
    setActiveConversation(null);
    setMessages([]);
    setTypingUserIds(new Set());
    setEditingMessageId(null);
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
    setEditingMessageId(null);

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
      const fullConv = { ...conv, type: 'group', members, lastMessage: null, unreadCount: 0 };
      setConversations((prev) => [fullConv, ...prev]);
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

  const handleSend = (e) => {
    e.preventDefault();
    setError('');

    if (!messageInput.trim() || !activeConversation) return;

    const socket = getSocket();
    if (!socket) {
      setError('Not connected to chat server.');
      return;
    }

    stopTypingSignal(activeConversation._id);

    socket.emit(
      'send_message',
      { conversationId: activeConversation._id, content: messageInput },
      (ack) => {
        if (!ack?.success) setError(ack?.message || 'Failed to send message');
      }
    );
    setMessageInput('');
    isNearBottomRef.current = true;
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

  const otherUsers = allUsers.filter((u) => u._id !== user._id);

  const filteredOtherUsers = otherUsers.filter((u) =>
    u.name?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredConversations = conversations
    .filter((conv) => conv.type === activeTab)
    .filter((conv) => conversationLabel(conv)?.toLowerCase().includes(search.toLowerCase()));

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const nameFor = (userId) => {
    if (activeConversation?.type === 'group') {
      return activeConversation.members?.find((m) => m._id === userId)?.name || 'Someone';
    }
    return activeConversation?.otherUser?.name || 'Someone';
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
      const onlineCount = (activeConversation.members || []).filter((m) =>
        onlineUserIds.has(m._id)
      ).length;
      return `${onlineCount} member${onlineCount === 1 ? '' : 's'} online`;
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

  return (
    <DashboardLayout>
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-72 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => openToastConversation(t)}
            className="text-left bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-lg shadow-lg p-3 relative"
          >
            <span
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(t.id);
              }}
              role="button"
              tabIndex={0}
              aria-label="Dismiss notification"
              className="absolute top-2 right-2 text-muted text-xs"
            >
              ✕
            </span>
            <p className="text-sm font-semibold text-ink dark:text-ink-dark pr-4">{t.title}</p>
            <p className="text-xs text-muted mt-0.5 truncate">{t.body}</p>
          </button>
        ))}
      </div>

      <div className="flex h-[calc(100svh-2.5rem)] md:h-[calc(100svh-4rem)] -m-5 md:-m-8 border-t border-line dark:border-line-dark">
        <aside
          className={`w-full sm:w-72 flex-shrink-0 border-r border-line dark:border-line-dark bg-surface dark:bg-surface-dark overflow-y-auto sm:flex sm:flex-col ${
            activeConversation ? 'hidden' : 'flex flex-col'
          }`}
        >
          <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink dark:text-ink-dark">Message</h2>
            {totalUnread > 0 && (
              <span className="text-xs text-accent font-medium">
                {totalUnread} new message{totalUnread === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {socketStatus !== 'connected' && (
            <div
              className={`mx-4 mb-3 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                socketStatus === 'error'
                  ? 'bg-danger-soft text-danger'
                  : 'bg-accent-soft text-accent'
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

          <div className="px-4 pb-3">
            <div className="relative">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                aria-label="Search conversations"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-line dark:border-line-dark bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          <div className="px-4 pb-3 flex items-center gap-2">
            <div className="flex-1 flex bg-page dark:bg-page-dark rounded-lg p-1">
              <button
                onClick={() => setActiveTab('private')}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'private'
                    ? 'bg-ink dark:bg-ink-dark text-page dark:text-page-dark'
                    : 'text-muted'
                }`}
              >
                Chats
              </button>
              <button
                onClick={() => setActiveTab('group')}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'group'
                    ? 'bg-ink dark:bg-ink-dark text-page dark:text-page-dark'
                    : 'text-muted'
                }`}
              >
                Group
              </button>
            </div>
            <button
              onClick={() => setShowCreate((v) => !v)}
              aria-label={activeTab === 'private' ? 'Start new chat' : 'Create new group'}
              className={`w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center transition-colors ${
                showCreate ? 'bg-accent text-white' : 'bg-accent-soft text-accent'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {showCreate && activeTab === 'private' && (
            <div className="border-y border-line dark:border-line-dark max-h-64 overflow-y-auto">
              {filteredOtherUsers.length === 0 && (
                <p className="text-sm text-muted text-center py-4">No users found.</p>
              )}
              {filteredOtherUsers.map((u) => (
                <button
                  key={u._id}
                  onClick={() => startPrivateChat(u)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink dark:text-ink-dark hover:bg-page dark:hover:bg-page-dark"
                >
                  <span className="w-7 h-7 rounded-full bg-nav-active dark:bg-nav-active-dark text-nav-active-ink dark:text-nav-active-ink-dark flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    {u.name?.[0]?.toUpperCase()}
                  </span>
                  {u.name}
                </button>
              ))}
            </div>
          )}

          {showCreate && activeTab === 'group' && (
            <div className="border-y border-line dark:border-line-dark p-3 flex flex-col gap-2 max-h-80 overflow-y-auto">
              <input
                type="text"
                placeholder="Group name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="px-2.5 py-2 rounded-lg border border-line dark:border-line-dark bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none focus:border-accent"
              />
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                {filteredOtherUsers.map((u) => (
                  <label
                    key={u._id}
                    className="flex items-center gap-2 text-sm text-ink dark:text-ink-dark px-1 py-1"
                  >
                    <input
                      type="checkbox"
                      checked={groupMemberIds.includes(u._id)}
                      onChange={() => toggleGroupMember(u._id)}
                    />
                    {u.name}
                  </label>
                ))}
              </div>
              <button
                onClick={createGroup}
                className="py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90"
              >
                Create Group
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loadingConversations && (
              <p className="text-sm text-muted text-center py-6">Loading...</p>
            )}
            {!loadingConversations && filteredConversations.length === 0 && (
              <p className="text-sm text-muted text-center py-6 px-4">
                {search
                  ? 'No matches found.'
                  : `${activeTab === 'private' ? 'No chats yet.' : 'No groups yet.'} Tap + to start one.`}
              </p>
            )}
            {filteredConversations.map((conv) => {
              const isOnline =
                conv.type === 'private' && onlineUserIds.has(conv.otherUser?._id);
              const statusText =
                conv.type === 'group'
                  ? `${(conv.members || []).length} members`
                  : isOnline
                    ? 'Online'
                    : 'Offline';

              return (
                <button
                  key={conv._id}
                  onClick={() => openConversation(conv)}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-line dark:border-line-dark transition-colors ${
                    activeConversation?._id === conv._id
                      ? 'bg-nav-active dark:bg-nav-active-dark'
                      : 'hover:bg-page dark:hover:bg-page-dark'
                  }`}
                >
                  <span className="relative flex-shrink-0">
                    <span className="w-11 h-11 rounded-full bg-nav-active dark:bg-nav-active-dark text-nav-active-ink dark:text-nav-active-ink-dark flex items-center justify-center text-sm font-semibold">
                      {conversationInitial(conv)}
                    </span>
                    {conv.type === 'private' && (
                      <span
                        className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-surface dark:border-surface-dark ${
                          isOnline ? 'bg-green-500' : 'bg-gray-400'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink dark:text-ink-dark truncate">
                        {conversationLabel(conv)}
                      </p>
                      {conv.lastMessage && (
                        <span className="text-[11px] text-muted flex-shrink-0">
                          {new Date(conv.lastMessage.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted flex items-center gap-1 mt-0.5">
                      {conv.type === 'private' && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}
                          aria-hidden="true"
                        />
                      )}
                      {statusText}
                    </p>
                    <p className="text-xs text-muted truncate mt-0.5">
                      {conv.lastMessage ? conv.lastMessage.content : 'No messages yet'}
                    </p>
                  </div>
                  {conv.unreadCount > 0 && (
                    <span
                      className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center flex-shrink-0 mt-1"
                      aria-label={`${conv.unreadCount} unread messages`}
                    >
                      {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        <section
          className={`flex-1 flex-col min-w-0 relative sm:flex ${activeConversation ? 'flex' : 'hidden sm:flex'}`}
        >
          {!activeConversation ? (
            <div className="flex-1 flex items-center justify-center text-muted text-sm">
              Select a conversation, or start a new chat/group
            </div>
          ) : (
            <>
              <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line dark:border-line-dark bg-surface dark:bg-surface-dark">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    onClick={closeActiveConversation}
                    aria-label="Back to conversations"
                    className="sm:hidden -ml-1 p-1 text-ink dark:text-ink-dark flex-shrink-0"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <span className="w-8 h-8 rounded-full bg-nav-active dark:bg-nav-active-dark text-nav-active-ink dark:text-nav-active-ink-dark flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    {conversationInitial(activeConversation)}
                  </span>
                  <span className="font-semibold text-ink dark:text-ink-dark truncate">
                    {conversationLabel(activeConversation)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted flex-shrink-0">
                  {activeConversation.type === 'private' && (
                    <span
                      className={`w-2 h-2 rounded-full ${
                        onlineUserIds.has(activeConversation.otherUser?._id)
                          ? 'bg-green-500'
                          : 'bg-gray-400'
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  {presenceLabel()}
                </div>
              </header>

              <div
                ref={messagesContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2.5"
              >
                {loadingOlder && (
                  <p className="text-xs text-muted text-center py-1">Loading older messages...</p>
                )}
                {loadingMessages && (
                  <p className="text-sm text-muted text-center">Loading messages...</p>
                )}
                {!loadingMessages && messages.length === 0 && (
                  <p className="text-sm text-muted text-center mt-8">
                    No messages yet. Say hello!
                  </p>
                )}
                {messages.map((msg) => {
                  const msgId = (msg.id || msg._id)?.toString();
                  const senderId = getSenderId(msg);
                  const isMine = senderId === user._id;
                  const senderName =
                    typeof msg.senderId === 'object' ? msg.senderId.name : nameFor(senderId);
                  const status = isMine ? getMessageStatus(msg) : null;
                  const isEditing = editingMessageId === msgId;

                  return (
                    <Fragment key={msgId}>
                      {dividerMessageId === msgId && (
                        <div className="flex items-center gap-2 my-1" aria-hidden="true">
                          <div className="flex-1 h-px bg-line dark:bg-line-dark" />
                          <span className="text-[11px] text-muted whitespace-nowrap">New Messages</span>
                          <div className="flex-1 h-px bg-line dark:bg-line-dark" />
                        </div>
                      )}
                      <div
                        className={`max-w-[75%] flex flex-col gap-0.5 ${
                          isMine ? 'self-end items-end' : 'self-start items-start'
                        }`}
                      >
                        {!isMine && activeConversation.type === 'group' && (
                          <span className="text-[11px] font-medium text-muted px-1">{senderName}</span>
                        )}

                        {isEditing ? (
                          <div className="flex items-center gap-1.5 w-full">
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
                              className="flex-1 px-2.5 py-1.5 rounded-lg border border-accent bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none"
                            />
                            <button
                              onClick={saveEdit}
                              aria-label="Save edit"
                              className="text-xs text-accent font-medium"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              aria-label="Cancel edit"
                              className="text-xs text-muted"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div
                            className={`px-3 py-2 rounded-2xl text-sm break-words ${
                              msg.isDeleted
                                ? 'italic text-muted border border-line dark:border-line-dark'
                                : isMine
                                  ? 'bg-accent text-white rounded-br-sm'
                                  : 'bg-surface dark:bg-surface-dark border border-line dark:border-line-dark text-ink dark:text-ink-dark rounded-bl-sm'
                            }`}
                          >
                            {msg.content}
                          </div>
                        )}

                        <div className="flex items-center gap-1 px-1">
                          <span className="text-[11px] text-muted">
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {msg.edited && !msg.isDeleted && (
                            <span className="text-[11px] text-muted italic">(edited)</span>
                          )}
                          {isMine && !msg.isDeleted && (
                            <span
                              className={`text-[11px] ${status === 'read' ? 'text-blue-500' : 'text-muted'}`}
                              title={status}
                            >
                              {status === 'sent' ? '✓' : '✓✓'}
                            </span>
                          )}
                        </div>

                        {isMine && !msg.isDeleted && !isEditing && (
                          <div className="flex items-center gap-2 px-1">
                            <button
                              onClick={() => startEdit(msg)}
                              className="text-[11px] text-muted hover:text-accent"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteMessage(msg)}
                              className="text-[11px] text-muted hover:text-danger"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </Fragment>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {showScrollButton && (
                <button
                  onClick={scrollToBottom}
                  aria-label="Scroll to latest messages"
                  className="absolute bottom-24 right-6 w-9 h-9 rounded-full bg-surface dark:bg-surface-dark border border-line dark:border-line-dark shadow-lg flex items-center justify-center text-ink dark:text-ink-dark"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}

              {typingText() && (
                <div className="px-5 pb-1 text-xs text-muted italic">{typingText()}</div>
              )}

              {error && (
                <div className="mx-5 mb-2 bg-danger-soft text-danger rounded-lg px-3 py-2 text-xs">
                  {error}
                </div>
              )}

              <form
                onSubmit={handleSend}
                className="flex items-center gap-2 px-5 py-3 border-t border-line dark:border-line-dark bg-surface dark:bg-surface-dark"
              >
                <input
                  type="text"
                  value={messageInput}
                  onChange={handleInputChange}
                  placeholder="Type a message..."
                  aria-label="Message"
                  maxLength={5000}
                  className="flex-1 px-3 py-2.5 rounded-lg border border-line dark:border-line-dark bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none focus:border-accent transition-colors"
                />
                <button
                  type="submit"
                  disabled={!messageInput.trim()}
                  className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
                >
                  Send
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}

export default Chat;

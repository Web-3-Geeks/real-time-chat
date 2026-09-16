import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import axiosInstance from '../api/axiosInstance';
import { getSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';

const getSenderId = (msg) => (typeof msg.senderId === 'object' ? msg.senderId._id : msg.senderId);

const conversationLabel = (conv) => (conv.type === 'group' ? conv.name : conv.otherUser?.name || 'Unknown');

const conversationInitial = (conv) => conversationLabel(conv)?.[0]?.toUpperCase() || '?';

const TYPING_TIMEOUT_MS = 2000;

function Chat() {
  const { user, socketStatus } = useAuth();
  const location = useLocation();

  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [error, setError] = useState('');
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [typingUserIds, setTypingUserIds] = useState(new Set());
  const [unreadIds, setUnreadIds] = useState(new Set());

  const [allUsers, setAllUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('private'); // 'private' | 'group'
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState([]);
  const [search, setSearch] = useState('');

  const messagesEndRef = useRef(null);
  const activeConversationRef = useRef(null);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  useEffect(() => {
    axiosInstance.get('/users').then((res) => setAllUsers(res.data));
    axiosInstance
      .get('/conversations')
      .then((res) => setConversations(res.data))
      .finally(() => setLoadingConversations(false));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Global listeners: independent of which conversation is currently open.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleReceive = (msg) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c._id === msg.conversationId);
        if (idx === -1) {
          // Message for a conversation we don't have locally yet — e.g. someone
          // just started a brand-new chat/group with us. Re-fetch the full list
          // (with proper otherUser/members/type) instead of dropping the event.
          axiosInstance.get('/conversations').then((res) => setConversations(res.data));
          return prev;
        }
        const updated = {
          ...prev[idx],
          lastMessage: { content: msg.content, createdAt: msg.createdAt },
          updatedAt: msg.createdAt,
        };
        const rest = prev.filter((_, i) => i !== idx);
        return [updated, ...rest];
      });

      if (msg.conversationId === activeConversationRef.current?._id) {
        setMessages((prev) => [...prev, msg]);
      } else {
        setUnreadIds((prev) => new Set(prev).add(msg.conversationId));
      }
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

    socket.on('receive_message', handleReceive);
    socket.on('user_online', handleOnline);
    socket.on('user_offline', handleOffline);
    socket.on('typing_start', handleTypingStart);
    socket.on('typing_stop', handleTypingStop);

    return () => {
      socket.off('receive_message', handleReceive);
      socket.off('user_online', handleOnline);
      socket.off('user_offline', handleOffline);
      socket.off('typing_start', handleTypingStart);
      socket.off('typing_stop', handleTypingStop);
    };
    // Re-run once the socket actually exists/reconnects: on a fresh page load
    // that lands directly on this route, React fires this (child) component's
    // effects before AuthProvider's (parent) effect that creates the socket,
    // so getSocket() can still be null on the first pass — this depends on
    // socketStatus so it retries once AuthContext finishes connecting.
  }, [socketStatus]);

  const stopTypingSignal = (conversationId) => {
    clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      getSocket()?.emit('typing_stop', conversationId);
      isTypingRef.current = false;
    }
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
    setUnreadIds((prev) => {
      const next = new Set(prev);
      next.delete(conv._id);
      return next;
    });

    try {
      const { data: history } = await axiosInstance.get(`/conversations/${conv._id}/messages`);
      setMessages(history);

      if (!socket) {
        setError('Not connected to chat server yet. Please wait a moment and try again.');
        return;
      }

      socket.emit('join_conversation', conv._id, (ack) => {
        if (!ack?.success) {
          setError(ack?.message || 'Could not join conversation');
          return;
        }
        setOnlineUserIds((prev) => new Set([...prev, ...(ack.onlineMembers || [])]));
      });
    } catch {
      setError('Failed to open conversation. Please try again.');
    } finally {
      setLoadingMessages(false);
    }
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
      const fullConv = { ...conv, type: 'private', otherUser, lastMessage: null };
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
      const fullConv = { ...conv, type: 'group', members, lastMessage: null };
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
  };

  const otherUsers = allUsers.filter((u) => u._id !== user._id);

  const filteredOtherUsers = otherUsers.filter((u) =>
    u.name?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredConversations = conversations
    .filter((conv) => conv.type === activeTab)
    .filter((conv) => conversationLabel(conv)?.toLowerCase().includes(search.toLowerCase()));

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

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100svh-2.5rem)] md:h-[calc(100svh-4rem)] -m-5 md:-m-8 border-t border-line dark:border-line-dark">
        <aside className="w-72 flex-shrink-0 border-r border-line dark:border-line-dark bg-surface dark:bg-surface-dark overflow-y-auto hidden sm:flex sm:flex-col">
          <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink dark:text-ink-dark">Message</h2>
            {unreadIds.size > 0 && (
              <span className="text-xs text-accent font-medium">
                {unreadIds.size} new message{unreadIds.size === 1 ? '' : 's'}
              </span>
            )}
          </div>

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
                  {unreadIds.has(conv._id) && (
                    <span
                      className="w-2 h-2 rounded-full bg-accent flex-shrink-0 mt-1.5"
                      aria-label="Unread message"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex-1 flex flex-col min-w-0">
          {!activeConversation ? (
            <div className="flex-1 flex items-center justify-center text-muted text-sm">
              Select a conversation, or start a new chat/group
            </div>
          ) : (
            <>
              <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line dark:border-line-dark bg-surface dark:bg-surface-dark">
                <div className="flex items-center gap-2.5 min-w-0">
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

              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2.5">
                {loadingMessages && (
                  <p className="text-sm text-muted text-center">Loading messages...</p>
                )}
                {!loadingMessages && messages.length === 0 && (
                  <p className="text-sm text-muted text-center mt-8">
                    No messages yet. Say hello!
                  </p>
                )}
                {messages.map((msg) => {
                  const senderId = getSenderId(msg);
                  const isMine = senderId === user._id;
                  const senderName =
                    typeof msg.senderId === 'object' ? msg.senderId.name : nameFor(senderId);

                  return (
                    <div
                      key={msg.id || msg._id}
                      className={`max-w-[75%] flex flex-col gap-0.5 ${
                        isMine ? 'self-end items-end' : 'self-start items-start'
                      }`}
                    >
                      {!isMine && activeConversation.type === 'group' && (
                        <span className="text-[11px] font-medium text-muted px-1">{senderName}</span>
                      )}
                      <div
                        className={`px-3 py-2 rounded-2xl text-sm break-words ${
                          isMine
                            ? 'bg-accent text-white rounded-br-sm'
                            : 'bg-surface dark:bg-surface-dark border border-line dark:border-line-dark text-ink dark:text-ink-dark rounded-bl-sm'
                        }`}
                      >
                        {msg.content}
                      </div>
                      <span className="text-[11px] text-muted px-1">
                        {new Date(msg.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

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

import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import axiosInstance from '../api/axiosInstance';
import { getSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';

const getSenderId = (msg) => (typeof msg.senderId === 'object' ? msg.senderId._id : msg.senderId);

const statusStyles = {
  connected: { label: 'Connected', dot: 'bg-green-500' },
  connecting: { label: 'Connecting...', dot: 'bg-yellow-500' },
  disconnected: { label: 'Disconnected', dot: 'bg-gray-400' },
  error: { label: 'Connection error', dot: 'bg-danger' },
};

function Chat() {
  const { user, socketStatus } = useAuth();
  const location = useLocation();
  const [users, setUsers] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    axiosInstance.get('/users').then((res) => setUsers(res.data));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleReceive = (msg) => {
      if (msg.conversationId === activeConversation?._id) {
        setMessages((prev) => [...prev, msg]);
      }
    };

    socket.on('receive_message', handleReceive);
    return () => socket.off('receive_message', handleReceive);
  }, [activeConversation]);

  const handleSelectUser = async (otherUser) => {
    setError('');
    const socket = getSocket();

    if (activeConversation) {
      socket?.emit('leave_conversation', activeConversation._id);
    }

    setActiveUser(otherUser);
    setActiveConversation(null);
    setMessages([]);
    setLoadingMessages(true);

    try {
      const { data: conversation } = await axiosInstance.post('/conversations', {
        recipientId: otherUser._id,
      });
      setActiveConversation(conversation);

      const { data: history } = await axiosInstance.get(
        `/conversations/${conversation._id}/messages`
      );
      setMessages(history);

      if (!socket) {
        setError('Not connected to chat server yet. Please wait a moment and try again.');
        return;
      }

      socket.emit('join_conversation', conversation._id, (ack) => {
        if (!ack?.success) setError(ack?.message || 'Could not join conversation');
      });
    } catch {
      setError('Failed to open conversation. Please try again.');
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    const openUserId = location.state?.openUserId;
    if (!openUserId || users.length === 0) return;

    const targetUser = users.find((u) => u._id === openUserId);
    if (targetUser) queueMicrotask(() => handleSelectUser(targetUser));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, location.state]);

  const handleSend = (e) => {
    e.preventDefault();
    setError('');

    if (!messageInput.trim() || !activeConversation) return;

    const socket = getSocket();
    if (!socket || socketStatus !== 'connected') {
      setError('Not connected to chat server.');
      return;
    }

    socket.emit(
      'send_message',
      { conversationId: activeConversation._id, content: messageInput },
      (ack) => {
        if (!ack?.success) setError(ack?.message || 'Failed to send message');
      }
    );
    setMessageInput('');
  };

  const status = statusStyles[socketStatus] || statusStyles.disconnected;

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100svh-2.5rem)] md:h-[calc(100svh-4rem)] -m-5 md:-m-8 border-t border-line dark:border-line-dark">
        <aside className="w-64 flex-shrink-0 border-r border-line dark:border-line-dark bg-surface dark:bg-surface-dark overflow-y-auto hidden sm:block">
          <div className="px-4 py-3 border-b border-line dark:border-line-dark">
            <h2 className="text-sm font-semibold text-ink dark:text-ink-dark">Users</h2>
          </div>
          {users.length === 0 && (
            <p className="text-sm text-muted px-4 py-6 text-center">No other users yet.</p>
          )}
          {users.map((u) => (
            <button
              key={u._id}
              onClick={() => handleSelectUser(u)}
              className={`w-full flex items-center gap-2.5 px-4 py-3 text-left text-sm transition-colors ${
                activeUser?._id === u._id
                  ? 'bg-nav-active dark:bg-nav-active-dark text-nav-active-ink dark:text-nav-active-ink-dark'
                  : 'text-ink dark:text-ink-dark hover:bg-page dark:hover:bg-page-dark'
              }`}
            >
              <span className="w-8 h-8 rounded-full bg-nav-active dark:bg-nav-active-dark text-nav-active-ink dark:text-nav-active-ink-dark flex items-center justify-center text-xs font-semibold flex-shrink-0">
                {u.name?.[0]?.toUpperCase() || '?'}
              </span>
              <span className="truncate">{u.name}</span>
            </button>
          ))}
        </aside>

        <section className="flex-1 flex flex-col min-w-0">
          {!activeUser ? (
            <div className="flex-1 flex items-center justify-center text-muted text-sm">
              Select a user to start chatting
            </div>
          ) : (
            <>
              <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line dark:border-line-dark bg-surface dark:bg-surface-dark">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-full bg-nav-active dark:bg-nav-active-dark text-nav-active-ink dark:text-nav-active-ink-dark flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    {activeUser.name?.[0]?.toUpperCase() || '?'}
                  </span>
                  <span className="font-semibold text-ink dark:text-ink-dark truncate">
                    {activeUser.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted flex-shrink-0">
                  <span className={`w-2 h-2 rounded-full ${status.dot}`} aria-hidden="true" />
                  {status.label}
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
                  const isMine = getSenderId(msg) === user._id;
                  return (
                    <div
                      key={msg.id || msg._id}
                      className={`max-w-[75%] flex flex-col gap-0.5 ${
                        isMine ? 'self-end items-end' : 'self-start items-start'
                      }`}
                    >
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
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="Type a message..."
                  aria-label="Message"
                  className="flex-1 px-3 py-2.5 rounded-lg border border-line dark:border-line-dark bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none focus:border-accent transition-colors"
                />
                <button
                  type="submit"
                  disabled={!messageInput.trim() || socketStatus !== 'connected'}
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

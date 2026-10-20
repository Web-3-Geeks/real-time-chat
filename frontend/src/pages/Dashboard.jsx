import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import Avatar from '../components/Avatar';
import axiosInstance from '../api/axiosInstance';
import { previewText } from '../utils/messages';
import { listTime } from '../utils/time';
import { useAuth } from '../context/AuthContext';

function Dashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isNewUser = location.state?.isNewUser;

  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axiosInstance
      .get('/conversations')
      .then((res) => setConversations(res.data))
      .finally(() => setLoading(false));
  }, []);

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const stats = [
    { label: 'Conversations', value: conversations.length },
    { label: 'Unread messages', value: totalUnread, highlight: totalUnread > 0 },
    { label: 'Groups', value: conversations.filter((c) => c.type === 'group').length },
  ];

  return (
    <DashboardLayout unreadCount={totalUnread}>
      <div className="max-w-4xl mx-auto">
        <div className="bg-linear-to-r from-accent-light to-accent rounded-2xl p-6 md:p-7 text-white shadow-lg shadow-accent/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl md:text-2xl font-semibold">
              {isNewUser ? `Welcome, ${user?.name}` : `Welcome back, ${user?.name}`} 👋
            </h2>
            <p className="text-sm text-white/85 mt-1.5">Here's what's happening with your account.</p>
          </div>
          <button
            onClick={() => navigate('/chat')}
            className="self-start sm:self-auto px-5 py-2.5 rounded-full bg-white text-accent text-sm font-semibold hover:bg-white/90 transition-colors"
          >
            Open chats
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 md:gap-4 mt-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-surface dark:bg-surface-dark rounded-2xl shadow-sm p-4 md:p-5">
              <p className={`text-2xl font-bold ${s.highlight ? 'text-accent' : 'text-ink dark:text-ink-dark'}`}>
                {loading ? '–' : s.value}
              </p>
              <p className="text-xs text-muted mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 bg-surface dark:bg-surface-dark rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-line dark:border-line-dark">
            <h3 className="text-base font-semibold text-ink dark:text-ink-dark">Recent Conversations</h3>
          </div>

          {loading && <p className="text-sm text-muted text-center py-10">Loading...</p>}

          {!loading && conversations.length === 0 && (
            <div className="px-6 py-10 text-center">
              <p className="font-semibold text-ink dark:text-ink-dark mb-1.5">No conversations yet.</p>
              <p className="text-sm text-muted">Head over to Chats to start a conversation with someone.</p>
            </div>
          )}

          {!loading &&
            conversations.map((conv) => {
              const label = conv.type === 'group' ? conv.name : conv.otherUser?.name || 'Unknown user';
              return (
                <button
                  key={conv._id}
                  onClick={() => navigate('/chat', { state: { openConversationId: conv._id } })}
                  className="w-full flex items-center gap-3 px-5 py-3 text-left border-b border-line dark:border-line-dark last:border-b-0 hover:bg-nav-active dark:hover:bg-nav-active-dark transition-colors"
                >
                  <Avatar
                    name={label}
                    src={conv.type === 'private' ? conv.otherUser?.avatar : undefined}
                    group={conv.type === 'group'}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink dark:text-ink-dark truncate">{label}</p>
                    <p className="text-xs text-muted truncate">
                      {conv.lastMessage ? previewText(conv.lastMessage) : 'No messages yet'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {conv.lastMessage && (
                      <span className="text-[11px] text-muted">
                        {listTime(conv.lastMessage.createdAt)}
                      </span>
                    )}
                    {conv.unreadCount > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center">
                        {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
        </div>
      </div>
    </DashboardLayout>
  );
}

export default Dashboard;

import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import axiosInstance from '../api/axiosInstance';
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

  return (
    <DashboardLayout>
      <h2 className="text-xl font-semibold text-ink dark:text-ink-dark">
        {isNewUser ? `Welcome, ${user?.name}` : `Welcome back, ${user?.name}`}
      </h2>
      <p className="text-sm text-muted mt-1.5">Here's what's happening with your account.</p>

      <div className="mt-8 bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-line dark:border-line-dark">
          <h3 className="text-sm font-semibold text-ink dark:text-ink-dark">
            Recent Conversations
          </h3>
        </div>

        {loading && <p className="text-sm text-muted text-center py-10">Loading...</p>}

        {!loading && conversations.length === 0 && (
          <div className="px-6 py-10 text-center">
            <p className="font-semibold text-ink dark:text-ink-dark mb-1.5">
              No conversations yet.
            </p>
            <p className="text-sm text-muted">
              Head over to Chats to start a conversation with someone.
            </p>
          </div>
        )}

        {!loading &&
          conversations.map((conv) => (
            <button
              key={conv._id}
              onClick={() => navigate('/chat', { state: { openUserId: conv.otherUser?._id } })}
              className="w-full flex items-center gap-3 px-5 py-3 text-left border-b border-line dark:border-line-dark last:border-b-0 hover:bg-page dark:hover:bg-page-dark transition-colors"
            >
              <span className="w-9 h-9 rounded-full bg-nav-active dark:bg-nav-active-dark text-nav-active-ink dark:text-nav-active-ink-dark flex items-center justify-center text-xs font-semibold flex-shrink-0">
                {conv.otherUser?.name?.[0]?.toUpperCase() || '?'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink dark:text-ink-dark truncate">
                  {conv.otherUser?.name || 'Unknown user'}
                </p>
                <p className="text-xs text-muted truncate">
                  {conv.lastMessage ? conv.lastMessage.content : 'No messages yet'}
                </p>
              </div>
              {conv.lastMessage && (
                <span className="text-[11px] text-muted flex-shrink-0">
                  {new Date(conv.lastMessage.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </button>
          ))}
      </div>
    </DashboardLayout>
  );
}

export default Dashboard;

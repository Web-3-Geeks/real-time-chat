import { useLocation } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { useAuth } from '../context/AuthContext';

function Dashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const isNewUser = location.state?.isNewUser;

  return (
    <DashboardLayout>
      <h2 className="text-xl font-semibold text-ink dark:text-ink-dark">
        {isNewUser ? `Welcome, ${user?.name}` : `Welcome back, ${user?.name}`}
      </h2>
      <p className="text-sm text-muted mt-1.5">Here's what's happening with your account.</p>

      <div className="mt-8 bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-2xl px-6 py-10 text-center">
        <p className="font-semibold text-ink dark:text-ink-dark mb-1.5">No conversations yet.</p>
        <p className="text-sm text-muted">
          Real-time messaging is coming in a future update — check back soon.
        </p>
      </div>
    </DashboardLayout>
  );
}

export default Dashboard;

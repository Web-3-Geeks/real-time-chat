import { useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';

function Profile() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSuccessMessage('');

    if (!name.trim()) {
      setFieldErrors({ name: 'Name is required' });
      return;
    }
    setFieldErrors({});

    setIsSubmitting(true);
    try {
      const res = await axiosInstance.patch('/users/me', { name, avatar });
      updateUser(res.data);
      setSuccessMessage('Profile updated successfully.');
    } catch (err) {
      setFormError(err.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <h2 className="text-xl font-semibold text-ink dark:text-ink-dark">Profile</h2>
      <p className="text-sm text-muted mt-1.5">Update your basic account information.</p>

      <div className="mt-6 bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-2xl p-6 max-w-md flex flex-col gap-4">
        {formError && (
          <div className="bg-danger-soft text-danger rounded-lg px-3 py-2.5 text-sm">
            {formError}
          </div>
        )}
        {successMessage && (
          <div className="bg-green-100 text-green-700 rounded-lg px-3 py-2.5 text-sm">
            {successMessage}
          </div>
        )}

        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-ink dark:text-ink-dark">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={user?.email || ''}
              disabled
              className="px-3 py-2.5 rounded-lg border border-line dark:border-line-dark bg-page dark:bg-page-dark text-muted text-sm outline-none cursor-not-allowed"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium text-ink dark:text-ink-dark">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-line dark:border-line-dark bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none focus:border-accent transition-colors"
            />
            {fieldErrors.name && <span className="text-xs text-danger">{fieldErrors.name}</span>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="avatar" className="text-sm font-medium text-ink dark:text-ink-dark">
              Avatar URL
            </label>
            <input
              id="avatar"
              type="text"
              placeholder="https://example.com/your-photo.jpg"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-line dark:border-line-dark bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none focus:border-accent transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-1 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
          >
            {isSubmitting ? 'Saving...' : 'Save changes'}
          </button>
        </form>
      </div>
    </DashboardLayout>
  );
}

export default Profile;

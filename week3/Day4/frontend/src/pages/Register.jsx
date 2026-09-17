import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';

function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const validate = () => {
    const errors = {};
    if (!name.trim()) errors.name = 'Name is required';

    if (!email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Enter a valid email address';
    }

    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    try {
      const res = await axiosInstance.post('/auth/register', { name, email, password });
      login(res.data);
      navigate('/dashboard', { state: { isNewUser: true } });
    } catch (err) {
      setFormError(err.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-svh flex items-center justify-center bg-page dark:bg-page-dark p-6">
      <div className="w-full max-w-sm bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-2xl shadow-sm p-8">
        <div className="w-10 h-10 rounded-lg bg-accent text-white flex items-center justify-center font-bold mb-5">
          RC
        </div>
        <h1 className="text-xl font-semibold text-ink dark:text-ink-dark">Create your account</h1>
        <p className="text-sm text-muted mt-1 mb-6">Join and start chatting in real time</p>

        {formError && (
          <div className="bg-danger-soft text-danger rounded-lg px-3 py-2.5 text-sm mb-4">
            {formError}
          </div>
        )}

        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium text-ink dark:text-ink-dark">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="px-3 py-2.5 rounded-lg border border-line dark:border-line-dark bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none focus:border-accent transition-colors"
            />
            {fieldErrors.name && <span className="text-xs text-danger">{fieldErrors.name}</span>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-ink dark:text-ink-dark">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="px-3 py-2.5 rounded-lg border border-line dark:border-line-dark bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none focus:border-accent transition-colors"
            />
            {fieldErrors.email && <span className="text-xs text-danger">{fieldErrors.email}</span>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-ink dark:text-ink-dark">
              Password
            </label>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            {fieldErrors.password && (
              <span className="text-xs text-danger">{fieldErrors.password}</span>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-1 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
          >
            {isSubmitting ? 'Creating account...' : 'Sign up'}
          </button>
        </form>

        <p className="text-center text-sm text-muted mt-5">
          Already have an account?{' '}
          <Link to="/login" className="text-accent font-medium hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Register;

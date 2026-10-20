import axios from 'axios';

// Fired when the server rejects our token (expired, or the user no longer
// exists). AuthContext listens for it and logs out, so the user lands on the
// login page instead of an app full of silently-empty lists.
export const SESSION_EXPIRED_EVENT = 'auth:session-expired';

const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    // A 401 from login/register just means wrong credentials, not a dead session.
    const isAuthForm = url.startsWith('/auth/login') || url.startsWith('/auth/register');
    if (error.response?.status === 401 && !isAuthForm && localStorage.getItem('token')) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;

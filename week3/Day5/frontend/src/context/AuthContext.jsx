import { createContext, useState, useContext, useEffect } from 'react';
import { connectSocket, disconnectSocket } from '../api/socket';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  })

  const [socketStatus, setSocketStatus] = useState(() =>
    localStorage.getItem('token') ? 'connecting' : 'disconnected'
  );

  const attachSocket = (token) => {
    const socket = connectSocket(token);

    // connectSocket() returns the same cached socket on every call (see its
    // own StrictMode comment), but attachSocket() itself gets called more
    // than once for that same socket — e.g. the mount effect below runs
    // twice under StrictMode. Without this guard each call would pile on
    // another 'connect'/'disconnect' listener, all firing setSocketStatus
    // for the same transition (harmless on its own, but exactly the kind of
    // duplicate-listener bug that shows up elsewhere as doubled messages).
    if (socket._statusListenersAttached) return;
    socket._statusListenersAttached = true;

    socket.on('connect', () => setSocketStatus('connected'));
    socket.on('disconnect', () => setSocketStatus('disconnected'));
    socket.on('connect_error', () => setSocketStatus('error'));
    // socket.io-client retries automatically after a drop (network blip,
    // server restart) — these fire on the underlying Manager, not the
    // socket itself, and are what let the UI show "Reconnecting..."
    // distinctly from a first-time "Connecting...".
    socket.io.on('reconnect_attempt', () => setSocketStatus('reconnecting'));
    socket.io.on('reconnect_failed', () => setSocketStatus('error'));
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) attachSocket(token);
    // No disconnect-on-cleanup here: AuthProvider wraps the whole app and this
    // effect's cleanup would otherwise fire on React 18 StrictMode's dev-only
    // mount->cleanup->remount cycle, tearing down and recreating the socket
    // (a fresh object) out from under any component that already grabbed a
    // reference to the old one and attached listeners to it. Logout is the
    // only place that should actually disconnect.
  }, []);

  const login = (userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', userData.token);
    setSocketStatus('connecting');
    attachSocket(userData.token);
  }

  const logout = () => {
  setUser(null);
  localStorage.removeItem('user');
  localStorage.removeItem('token');
  disconnectSocket();
  setSocketStatus('disconnected');
};

  const updateUser = (updatedFields) => {
    setUser((prev) => {
      const newUser = { ...prev, ...updatedFields };
      localStorage.setItem('user', JSON.stringify(newUser));
      return newUser;
    });
  };


  return (
  <AuthContext.Provider value={{ user, login, logout, updateUser, socketStatus }}>
    {children}
  </AuthContext.Provider>
);

}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
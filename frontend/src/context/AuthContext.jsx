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

    socket.on('connect', () => setSocketStatus('connected'));
    socket.on('disconnect', () => setSocketStatus('disconnected'));
    socket.on('connect_error', () => setSocketStatus('error'));
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
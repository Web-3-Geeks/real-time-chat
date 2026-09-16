import { io } from 'socket.io-client';

let socket = null;

export const connectSocket = (token) => {
  // Checking `socket` existing (not `.connected`) matters: React 18 StrictMode
  // invokes effects twice in dev, milliseconds apart, before the first
  // handshake has finished (so `.connected` would still be false) — without
  // this, that second call would spin up a second, separate socket connection.
  if (socket) return socket;

  socket = io(import.meta.env.VITE_SOCKET_URL, {
    auth: { token },
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = () => socket;

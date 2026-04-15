let ioInstance = null;
const actorSocketMap = new Map();
const socketActorMap = new Map();

const buildActorKey = ({ type = "", id = "" } = {}) => {
  const actorType = String(type || "").trim().toLowerCase();
  const actorId = String(id || "").trim();
  if (!actorType || !actorId) return "";
  return `${actorType}:${actorId}`;
};

const markActorOnline = ({ type = "", id = "", socketId = "" } = {}) => {
  const actorKey = buildActorKey({ type, id });
  const sid = String(socketId || "").trim();
  if (!actorKey || !sid) return;

  const current = actorSocketMap.get(actorKey) || { sockets: new Set(), lastSeenAt: null };
  current.sockets.add(sid);
  actorSocketMap.set(actorKey, current);
  socketActorMap.set(sid, actorKey);
};

const markSocketOffline = (socketId = "") => {
  const sid = String(socketId || "").trim();
  if (!sid) return;
  const actorKey = socketActorMap.get(sid);
  if (!actorKey) return;

  const current = actorSocketMap.get(actorKey);
  if (current?.sockets instanceof Set) {
    current.sockets.delete(sid);
    if (current.sockets.size <= 0) {
      actorSocketMap.set(actorKey, { sockets: new Set(), lastSeenAt: new Date() });
    } else {
      actorSocketMap.set(actorKey, current);
    }
  }

  socketActorMap.delete(sid);
};

const getActorPresence = ({ type = "", id = "" } = {}) => {
  const actorKey = buildActorKey({ type, id });
  if (!actorKey) return { online: false, lastSeenAt: null };

  const current = actorSocketMap.get(actorKey);
  if (!current) return { online: false, lastSeenAt: null };

  const online = current.sockets instanceof Set && current.sockets.size > 0;
  return {
    online,
    lastSeenAt: online ? null : current.lastSeenAt || null,
  };
};

const setSocketServer = (io) => {
  ioInstance = io;
};

const getSocketServer = () => ioInstance;

module.exports = {
  setSocketServer,
  getSocketServer,
  markActorOnline,
  markSocketOffline,
  getActorPresence,
};

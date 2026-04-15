const KhanNotification = require("../models/KhanNotification");
const { getSocketServer } = require("./SocketServer");

const normalizeText = (value = "") => String(value || "").trim();

const emitKhanNotification = (payload) => {
  const io = getSocketServer();
  if (!io) return;
  const room = `notification:${payload.recipientkind}:${payload.recipientid}`;
  io.to(room).emit("khan_notification", payload);
};

const pushKhanNotification = async ({
  recipientkind = "user",
  recipientid = null,
  type = "Info",
  channel = "general",
  title = "",
  message = "",
  metadata = {},
}) => {
  if (!recipientid) return null;

  const created = await KhanNotification.create({
    recipientkind,
    recipientid,
    type,
    channel: normalizeText(channel) || "general",
    title: normalizeText(title).slice(0, 240) || "Khan Notification",
    message: normalizeText(message).slice(0, 4000) || "New activity",
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  });

  emitKhanNotification({
    _id: String(created._id),
    recipientkind: created.recipientkind,
    recipientid: String(created.recipientid),
    type: created.type,
    channel: created.channel,
    title: created.title,
    message: created.message,
    metadata: created.metadata || {},
    isread: false,
    createdAt: created.createdAt,
  });

  return created;
};

module.exports = {
  pushKhanNotification,
};

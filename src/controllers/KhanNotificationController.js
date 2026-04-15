const sanitize = require("mongo-sanitize");
const mongoose = require("mongoose");
const User = require("../models/User");
const KhanNotification = require("../models/KhanNotification");

const normalizeText = (value = "") => String(value || "").trim();
const toNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : fallback;
};

const resolveRecipientKind = (role = "") => {
  const normalized = normalizeText(role).toLowerCase();
  if (normalized === "seller") return "seller";
  if (normalized === "superadmin") return "superadmin";
  return "user";
};

const ensureAuthUser = async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: "Please sign in first to continue." });
    return null;
  }

  const me = await User.findById(userId).select("_id role fullname").lean();
  if (!me) {
    res.status(404).json({ success: false, message: "User not found." });
    return null;
  }

  return me;
};

exports.getMyKhanNotifications = async (req, res) => {
  try {
    const me = await ensureAuthUser(req, res);
    if (!me) return;

    const query = sanitize(req.query || {});
    const page = toNumber(query.page, 1);
    const limit = Math.min(200, toNumber(query.limit, 50));
    const skip = (page - 1) * limit;

    const recipientkind = resolveRecipientKind(me.role);
    const filter = { recipientkind, recipientid: me._id };

    const q = normalizeText(query.q);
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(safe, "i");
      filter.$or = [{ title: regex }, { message: regex }, { channel: regex }];
    }

    if (normalizeText(query.unread).toLowerCase() === "true") {
      filter.isread = false;
    }

    const [count, rows, unread] = await Promise.all([
      KhanNotification.countDocuments(filter),
      KhanNotification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      KhanNotification.countDocuments({ recipientkind, recipientid: me._id, isread: false }),
    ]);

    return res.status(200).json({
      success: true,
      page,
      limit,
      count,
      unread,
      rows,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load notifications." });
  }
};

exports.markMyKhanNotificationRead = async (req, res) => {
  try {
    const me = await ensureAuthUser(req, res);
    if (!me) return;

    const id = normalizeText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid notification id." });

    const recipientkind = resolveRecipientKind(me.role);
    const row = await KhanNotification.findOneAndUpdate(
      { _id: id, recipientkind, recipientid: me._id },
      { $set: { isread: true, readat: new Date() } },
      { new: true }
    ).lean();

    if (!row) return res.status(404).json({ success: false, message: "Notification not found." });
    return res.status(200).json({ success: true, row });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update notification." });
  }
};

exports.markAllMyKhanNotificationsRead = async (req, res) => {
  try {
    const me = await ensureAuthUser(req, res);
    if (!me) return;

    const recipientkind = resolveRecipientKind(me.role);
    await KhanNotification.updateMany(
      { recipientkind, recipientid: me._id, isread: false },
      { $set: { isread: true, readat: new Date() } }
    );

    return res.status(200).json({ success: true, message: "All notifications marked as read." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update notifications." });
  }
};


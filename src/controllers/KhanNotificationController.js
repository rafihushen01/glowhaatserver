const sanitize = require("mongo-sanitize");
const mongoose = require("mongoose");
const User = require("../models/User");
const KhanNotification = require("../models/KhanNotification");
const { pushKhanNotification } = require("../utils/KhanNotifier");

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

const ensureSuperAdmin = async (req, res) => {
  const me = await ensureAuthUser(req, res);
  if (!me) return null;
  if (me.role !== "SuperAdmin") {
    res.status(403).json({ success: false, message: "Forbidden" });
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

const toRoleFromKind = (kind = "") => {
  const normalized = normalizeText(kind).toLowerCase();
  if (normalized === "seller") return "Seller";
  if (normalized === "superadmin") return "SuperAdmin";
  return "User";
};

exports.sendSuperAdminNotice = async (req, res) => {
  try {
    const admin = await ensureSuperAdmin(req, res);
    if (!admin) return;

    const payload = sanitize(req.body || {});
    const targetkind = normalizeText(payload.targetkind || "all").toLowerCase();
    const targetid = normalizeText(payload.targetid);
    const title = normalizeText(payload.title).slice(0, 240);
    const message = normalizeText(payload.message).slice(0, 4000);
    const type = normalizeText(payload.type) || "Info";
    const channel = normalizeText(payload.channel || "notice") || "notice";

    if (!title || !message) {
      return res.status(400).json({ success: false, message: "Title and message are required." });
    }

    if (targetid) {
      if (!mongoose.Types.ObjectId.isValid(targetid)) {
        return res.status(400).json({ success: false, message: "Invalid target user id." });
      }

      const targetUser = await User.findById(targetid).select("_id role fullname").lean();
      if (!targetUser) return res.status(404).json({ success: false, message: "Target user not found." });

      const recipientkind = resolveRecipientKind(targetUser.role);
      await pushKhanNotification({
        recipientkind,
        recipientid: targetUser._id,
        type,
        channel,
        title,
        message,
        metadata: {
          source: "superadmin_notice",
          sentby: String(admin._id),
          sentbyname: admin.fullname || "SuperAdmin",
        },
      });

      return res.status(200).json({ success: true, sent: 1, targetkind: recipientkind });
    }

    const allowedKinds = new Set(["all", "user", "seller", "superadmin"]);
    if (!allowedKinds.has(targetkind)) {
      return res.status(400).json({ success: false, message: "Invalid target kind." });
    }

    const roleFilter =
      targetkind === "all" ? {} : { role: toRoleFromKind(targetkind) };
    const users = await User.find(roleFilter).select("_id role").lean();

    let sent = 0;
    for (const entry of users) {
      try {
        await pushKhanNotification({
          recipientkind: resolveRecipientKind(entry.role),
          recipientid: entry._id,
          type,
          channel,
          title,
          message,
          metadata: {
            source: "superadmin_notice",
            sentby: String(admin._id),
            sentbyname: admin.fullname || "SuperAdmin",
          },
        });
        sent += 1;
      } catch (_error) {
        // Continue dispatching remaining notifications
      }
    }

    return res.status(200).json({
      success: true,
      message: "Notification broadcast completed.",
      sent,
      targetkind,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to send notice." });
  }
};

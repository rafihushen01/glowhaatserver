const sanitize = require("mongo-sanitize");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const SuperAdminLog = require("../models/SuperAdminLog");

const toSafeInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : fallback;
};

const buildFilters = (query = {}) => {
  const filters = {};
  if (query.role) filters.role = String(query.role).trim();
  if (query.gender) filters.gender = String(query.gender).trim();
  if (query.email) filters.email = String(query.email).trim().toLowerCase();
  if (query.mobile) filters.mobile = String(query.mobile).trim();

  if (query.userid && mongoose.Types.ObjectId.isValid(String(query.userid))) {
    filters._id = String(query.userid);
  }

  if (query.q) {
    const raw = String(query.q).trim();
    const safe = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(safe, "i");
    filters.$or = [
      { fullname: regex },
      { email: regex },
      { mobile: regex },
      { studentid: regex },
    ];
  }
  return filters;
};

const isValidPassword = (value = "") => {
  const password = String(value || "");
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
};

const ensureSuperAdmin = async (req, res) => {
  const userid = req.user?.userId;
  if (!userid) {
    res.status(401).json({ message: "Please sign in first to continue." });
    return null;
  }

  const me = await User.findById(userid).select("role email").lean();
  if (!me || me.role !== "SuperAdmin") {
    res.status(403).json({ message: "Forbidden" });
    return null;
  }
  return me;
};

const logAction = async (admin, action, targetids = [], metadata = {}) => {
  try {
    await SuperAdminLog.create({
      adminid: admin._id,
      adminemail: admin.email || "",
      action,
      targetids: targetids.map(String),
      metadata,
    });
  } catch (error) {
    // logging should never break main flow
  }
};

exports.listusers = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const query = sanitize(req.query || {});
    const page = toSafeInt(query.page, 1);
    const limit = toSafeInt(query.limit, 20);
    const skip = (page - 1) * limit;

    const filters = buildFilters(query);

    const [count, users] = await Promise.all([
      User.countDocuments(filters),
      User.find(filters)
        .select("_id fullname email mobile role gender usersavatar avatar isblocked createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      count,
      page,
      limit,
      pages: Math.ceil(count / limit),
      users,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.bulkupdate = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const payload = sanitize(req.body || {});
    const ids = Array.isArray(payload.ids) ? payload.ids : [];
    if (!ids.length) {
      return res.status(400).json({ message: "User ids required" });
    }

    const update = {};
    if (payload.isblocked !== undefined) update.isblocked = Boolean(payload.isblocked);
    if (payload.role) update.role = payload.role;

    const result = await User.updateMany(
      { _id: { $in: ids } },
      { $set: update }
    );

    await logAction(me, "BULK_UPDATE", ids, { update });
    return res.status(200).json({ success: true, modified: result.modifiedCount || 0 });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.bulkdelete = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const payload = sanitize(req.body || {});
    const ids = Array.isArray(payload.ids) ? payload.ids : [];
    if (!ids.length) {
      return res.status(400).json({ message: "User ids required" });
    }

    const result = await User.deleteMany({ _id: { $in: ids } });
    await logAction(me, "BULK_DELETE", ids, {});
    return res.status(200).json({ success: true, deleted: result.deletedCount || 0 });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.exportusers = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const query = sanitize(req.query || {});
    const filters = buildFilters(query);
    const users = await User.find(filters)
      .select("_id fullname email mobile role gender isblocked createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const headers = [
      "id",
      "fullname",
      "email",
      "mobile",
      "role",
      "gender",
      "isblocked",
      "createdAt",
    ];

    const escapeCsv = (value) => {
      const raw = value == null ? "" : String(value);
      if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
        return `"${raw.replace(/"/g, '""')}"`;
      }
      return raw;
    };

    const rows = users.map((u) =>
      [
        u._id,
        u.fullname || "",
        u.email || "",
        u.mobile || "",
        u.role || "",
        u.gender || "",
        u.isblocked ? "true" : "false",
        u.createdAt ? new Date(u.createdAt).toISOString() : "",
      ].map(escapeCsv).join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=khancosmetics-users.csv");
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.updateuser = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const payload = sanitize(req.body || {});
    const update = {};
    ["fullname", "email", "mobile", "gender", "role", "isblocked"].forEach((key) => {
      if (payload[key] !== undefined) update[key] = payload[key];
    });

    if (payload.password !== undefined) {
      const password = String(payload.password || "").trim();
      if (!isValidPassword(password)) {
        return res.status(400).json({
          message: "Password must be at least 8 characters and include letters and numbers",
        });
      }
      update.password = await bcrypt.hash(password, 12);
    }

    if (update.email) update.email = String(update.email).trim().toLowerCase();
    if (update.mobile) update.mobile = String(update.mobile).trim();

    const updated = await User.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }).select("_id fullname email mobile role gender usersavatar avatar isblocked");

    if (!updated) {
      return res.status(404).json({ message: "User not found" });
    }

    await logAction(me, "UPDATE_USER", [id], { fields: Object.keys(update) });
    return res.status(200).json({ success: true, user: updated });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.deleteuser = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const deleted = await User.findByIdAndDelete(id).select("_id fullname email");
    if (!deleted) {
      return res.status(404).json({ message: "User not found" });
    }

    await logAction(me, "DELETE_USER", [id], { email: deleted?.email || "" });
    return res.status(200).json({ success: true, user: deleted });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.listlogs = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const logs = await SuperAdminLog.find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({ success: true, logs });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};


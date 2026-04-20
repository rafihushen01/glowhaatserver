const User = require("../models/User.js");

const requireSuperAdmin = async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Please sign in first to continue." });
    }

    const existingUser = await User.findById(userId).select("role").lean();
    if (!existingUser) {
      return res.status(401).json({ success: false, message: "Session user not found." });
    }

    const role = String(existingUser.role || "").toLowerCase();
    if (role !== "superadmin") {
      return res.status(403).json({ success: false, message: "Only SuperAdmin can perform this action." });
    }

    return next();
  } catch (error) {
    return res.status(500).json({ success: false, message: "Authorization check failed." });
  }
};

module.exports = requireSuperAdmin;

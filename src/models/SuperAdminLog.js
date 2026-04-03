const mongoose = require("mongoose");

const superAdminLogSchema = new mongoose.Schema(
  {
    adminid: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    adminemail: { type: String, default: "" },
    action: { type: String, required: true }, // UPDATE_USER, DELETE_USER, BULK_UPDATE, BULK_DELETE
    targetids: { type: [String], default: [] },
    metadata: { type: Object, default: {} },
    createdat: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("superadminlog", superAdminLogSchema);


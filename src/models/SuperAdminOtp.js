const mongoose = require("mongoose");

const superAdminOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    otp: { type: String, required: true },
    expire: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("superadminotp", superAdminOtpSchema);


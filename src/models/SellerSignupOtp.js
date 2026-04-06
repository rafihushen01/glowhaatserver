const { default: mongoose } = require("mongoose");

const sellerSignupOtpSchema = new mongoose.Schema(
  {
    email: { type: String, trim: true, lowercase: true, index: true, required: true },
    otp: { type: String, required: true },
    expire: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SellerSignupOtp", sellerSignupOtpSchema);

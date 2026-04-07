const mongoose = require("mongoose");

const sellersubscriptionSchema = new mongoose.Schema(
  {
    sellerid: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    shopid: { type: mongoose.Schema.Types.ObjectId, ref: "SellerShop", required: true, index: true },
    planname: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 1000 },
    savingscredit: { type: Number, required: true, min: 0 },
    remainingcredit: { type: Number, required: true, min: 0 },
    senderbkashnumber: { type: String, required: true, trim: true },
    transactionid: { type: String, required: true, trim: true },
    paymentss: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Pending", "Verified", "Rejected", "Expired"],
      default: "Pending",
      index: true,
    },
    reviewedby: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedat: { type: Date, default: null },
    rejectreason: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SellerSubscription", sellersubscriptionSchema);

const mongoose = require("mongoose");

const sellercommissionpaymentSchema = new mongoose.Schema(
  {
    sellerid: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    shopid: { type: mongoose.Schema.Types.ObjectId, ref: "SellerShop", required: true, index: true },
    periodstart: { type: Date, required: true, index: true },
    periodend: { type: Date, required: true, index: true },
    dueat: { type: Date, required: true, index: true },
    totaldeliveredamount: { type: Number, default: 0 },
    percentage: { type: Number, default: 5 },
    commissionamount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Pending", "Submitted", "Verified", "Rejected", "Overdue"],
      default: "Pending",
      index: true,
    },
    senderbkashnumber: { type: String, default: "", trim: true },
    transactionid: { type: String, default: "", trim: true },
    paymentss: { type: String, default: "" },
    reviewedby: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedat: { type: Date, default: null },
    rejectreason: { type: String, default: "", trim: true },
    reminderssent: { type: Number, default: 0 },
  },
  { timestamps: true }
);

sellercommissionpaymentSchema.index({ sellerid: 1, periodstart: 1, periodend: 1 }, { unique: true });

module.exports = mongoose.model("SellerCommissionPayment", sellercommissionpaymentSchema);

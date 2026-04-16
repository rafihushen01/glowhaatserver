const mongoose = require("mongoose");

const evidenceSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    type: { type: String, enum: ["image", "video"], default: "image" },
    name: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const sellerShopReportSchema = new mongoose.Schema(
  {
    shopid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SellerShop",
      required: true,
      index: true,
    },
    sellerid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reporterid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    details: {
      type: String,
      default: "",
      trim: true,
      maxlength: 4000,
    },
    evidence: {
      type: [evidenceSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["Pending", "Investigating", "ActionTaken", "Rejected"],
      default: "Pending",
      index: true,
    },
    adminnote: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    reviewedby: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedat: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SellerShopReport", sellerShopReportSchema);

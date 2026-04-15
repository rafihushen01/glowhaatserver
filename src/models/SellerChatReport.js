const mongoose = require("mongoose");

const evidenceSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    type: { type: String, enum: ["image", "video"], required: true },
    name: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const sellerChatReportSchema = new mongoose.Schema(
  {
    threadid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SellerChatThread",
      required: true,
      index: true,
    },
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
      default: null,
      index: true,
    },
    reporterguestsessionid: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    reportername: {
      type: String,
      default: "Guest",
      trim: true,
      maxlength: 120,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
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
    healthdeduction: {
      type: Number,
      default: 0,
      min: 0,
      max: 50,
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
      index: true,
    },
    reviewedat: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

sellerChatReportSchema.index({ shopid: 1, createdAt: -1 });
sellerChatReportSchema.index({ sellerid: 1, createdAt: -1 });

module.exports = mongoose.model("SellerChatReport", sellerChatReportSchema);

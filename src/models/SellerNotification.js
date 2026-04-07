const mongoose = require("mongoose");

const sellernotificationSchema = new mongoose.Schema(
  {
    sellerid: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    shopid: { type: mongoose.Schema.Types.ObjectId, ref: "SellerShop", default: null, index: true },
    type: {
      type: String,
      enum: ["Info", "Warning", "Success", "Danger"],
      default: "Info",
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    isread: { type: Boolean, default: false, index: true },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SellerNotification", sellernotificationSchema);

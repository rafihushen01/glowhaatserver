const mongoose = require("mongoose");
const { pushKhanNotification } = require("../utils/KhanNotifier");

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

sellernotificationSchema.post("save", async function sellerNotificationMirror(doc) {
  try {
    await pushKhanNotification({
      recipientkind: "seller",
      recipientid: doc.sellerid,
      type: doc.type || "Info",
      channel: "seller",
      title: doc.title || "Seller notification",
      message: doc.message || "",
      metadata: {
        source: "seller_notification",
        sellernotificationid: String(doc._id),
        shopid: doc.shopid ? String(doc.shopid) : "",
        ...(doc.metadata || {}),
      },
    });
  } catch (_error) {
    // non-blocking mirror
  }
});

module.exports = mongoose.model("SellerNotification", sellernotificationSchema);

const mongoose = require("mongoose");

const khanNotificationSchema = new mongoose.Schema(
  {
    recipientkind: {
      type: String,
      enum: ["user", "seller", "superadmin"],
      required: true,
      index: true,
    },
    recipientid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["Info", "Warning", "Success", "Danger"],
      default: "Info",
    },
    channel: {
      type: String,
      default: "general",
      trim: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 240 },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    metadata: { type: Object, default: {} },
    isread: { type: Boolean, default: false, index: true },
    readat: { type: Date, default: null },
  },
  { timestamps: true }
);

khanNotificationSchema.index({ recipientkind: 1, recipientid: 1, createdAt: -1 });

module.exports = mongoose.model("KhanNotification", khanNotificationSchema);

const mongoose = require("mongoose");

const productShareSchema = new mongoose.Schema(
  {
    productid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "item",
      required: true,
      index: true,
    },
    productname: {
      type: String,
      default: "",
      trim: true,
    },
    productslug: {
      type: String,
      required: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    productcategorypath: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    productcategorytree: {
      type: [String],
      default: [],
      index: true,
    },
    platform: {
      type: String,
      enum: ["whatsapp", "facebook", "messenger", "instagram", "browser"],
      required: true,
      index: true,
    },
    sharedby: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sharedbyname: {
      type: String,
      default: "",
      trim: true,
    },
    sharedbyemail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },
    sharedbymobile: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    sharetoken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    shareurl: {
      type: String,
      default: "",
      trim: true,
    },
    opencount: {
      type: Number,
      default: 0,
      min: 0,
    },
    uniquevisitkeys: {
      type: [String],
      default: [],
      select: false,
    },
    lastopenedat: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

productShareSchema.index({ createdAt: -1 });
productShareSchema.index({ productid: 1, platform: 1, createdAt: -1 });

module.exports = mongoose.model("ProductShare", productShareSchema);

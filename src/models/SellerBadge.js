const mongoose = require("mongoose");

const sellerBadgeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 600,
    },
    image: {
      type: String,
      default: "",
      trim: true,
    },
    priority: {
      type: Number,
      default: 100,
      index: true,
    },
    isactive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdbyadminid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SellerBadge", sellerBadgeSchema);

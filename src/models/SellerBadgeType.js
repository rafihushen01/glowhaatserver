const mongoose = require("mongoose");

const sellerBadgeTypeSchema = new mongoose.Schema(
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
    isdefault: {
      type: Boolean,
      default: false,
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

module.exports = mongoose.model("SellerBadgeType", sellerBadgeTypeSchema);

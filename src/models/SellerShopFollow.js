const mongoose = require("mongoose");

const sellerShopFollowSchema = new mongoose.Schema(
  {
    shopid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SellerShop",
      required: true,
      index: true,
    },
    actorkey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    guestsessionid: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
  },
  { timestamps: true }
);

sellerShopFollowSchema.index({ shopid: 1, actorkey: 1 }, { unique: true });

module.exports = mongoose.model("SellerShopFollow", sellerShopFollowSchema);

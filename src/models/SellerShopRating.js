const mongoose = require("mongoose");

const sellerShopRatingSchema = new mongoose.Schema(
  {
    shopid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SellerShop",
      required: true,
      index: true,
    },
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    review: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    isverifiedbuyer: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

sellerShopRatingSchema.index({ shopid: 1, userid: 1 }, { unique: true });

module.exports = mongoose.model("SellerShopRating", sellerShopRatingSchema);

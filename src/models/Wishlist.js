const mongoose = require("mongoose");

const wishlistSchema = new mongoose.Schema(
  {
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    productid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "item",
      required: true,
      index: true,
    },
    slug: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    brand: { type: String, default: "" },
    image: { type: String, default: "" },
    baseprice: { type: Number, default: 0, min: 0 },
    currentprice: { type: Number, default: 0, min: 0 },
    productsnapshot: { type: Object, default: {} },
  },
  { timestamps: true }
);

wishlistSchema.index({ userid: 1, productid: 1 }, { unique: true });

module.exports = mongoose.model("wishlist", wishlistSchema);

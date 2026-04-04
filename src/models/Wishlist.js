const mongoose = require("mongoose");

const wishlistSchema = new mongoose.Schema(
  {
    ownerid: {
      type: String,
      required: true,
      index: true,
    },
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },
    guestid: { type: String, default: "", index: true },
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

wishlistSchema.index({ ownerid: 1, productid: 1 }, { unique: true });

module.exports = mongoose.model("wishlist", wishlistSchema);

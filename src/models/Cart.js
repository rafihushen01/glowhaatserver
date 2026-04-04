const mongoose = require("mongoose");

const cartItemSchema = new mongoose.Schema(
  {
    ownerid: {
      type: String,
      required: true,
      index: true,
    },
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
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
    name: { type: String, required: true },
    brand: { type: String, default: "" },
    image: { type: String, default: "" },
    variantname: { type: String, default: "" },
    optionname: { type: String, default: "" },
    variantindex: { type: Number, default: 0 },
    optionindex: { type: Number, default: 0 },
    unitprice: { type: Number, required: true, min: 0 },
    baseprice: { type: Number, default: 0, min: 0 },
    discountpercentage: { type: Number, default: 0, min: 0 },
    deliverycharge: { type: Number, default: 0, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    totalprice: { type: Number, required: true, min: 0 },
    productsnapshot: { type: Object, default: {} },
  },
  { timestamps: true }
);

cartItemSchema.index(
  { ownerid: 1, productid: 1, variantindex: 1, optionindex: 1 },
  { unique: true }
);

module.exports = mongoose.model("cart", cartItemSchema);

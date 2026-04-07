const mongoose = require("mongoose");

const sellerorderSchema = new mongoose.Schema(
  {
    orderid: { type: mongoose.Schema.Types.ObjectId, ref: "order", required: true, index: true },
    ordernumber: { type: String, required: true, index: true },
    sellerid: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    shopid: { type: mongoose.Schema.Types.ObjectId, ref: "SellerShop", required: true, index: true },
    customer: {
      fullname: { type: String, default: "" },
      email: { type: String, default: "" },
      mobile: { type: String, default: "" },
    },
    shippingaddress: { type: Object, default: {} },
    payment: { type: Object, default: {} },
    item: {
      productid: { type: mongoose.Schema.Types.ObjectId, ref: "item", required: true },
      slug: { type: String, default: "" },
      name: { type: String, default: "" },
      image: { type: String, default: "" },
      variantname: { type: String, default: "" },
      optionname: { type: String, default: "" },
      quantity: { type: Number, default: 1 },
      unitprice: { type: Number, default: 0 },
      totalprice: { type: Number, default: 0 },
      deliverycharge: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ["placed", "processing", "shipped", "delivered", "returned", "canceled"],
      default: "placed",
      index: true,
    },
    statushistory: {
      type: [
        {
          status: {
            type: String,
            enum: ["placed", "processing", "shipped", "delivered", "returned", "canceled"],
            required: true,
          },
          note: { type: String, default: "" },
          changedby: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          changedat: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    deliveredat: { type: Date, default: null },
  },
  { timestamps: true }
);

sellerorderSchema.index({ sellerid: 1, createdAt: -1 });
sellerorderSchema.index({ shopid: 1, createdAt: -1 });

module.exports = mongoose.model("SellerOrder", sellerorderSchema);

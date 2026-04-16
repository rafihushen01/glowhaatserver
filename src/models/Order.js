const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    productid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "item",
      required: true,
    },
    slug: { type: String, default: "" },
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
    quantity: { type: Number, required: true, min: 1 },
    totalprice: { type: Number, required: true, min: 0 },
    productsnapshot: { type: Object, default: {} },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["placed", "processing", "shipped", "delivered", "returned", "canceled"],
      required: true,
    },
    note: { type: String, default: "" },
    changedby: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    changedat: { type: Date, default: Date.now },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
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
    ordernumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    customer: {
      fullname: { type: String, required: true, trim: true },
      email: { type: String, default: "", trim: true, lowercase: true },
      mobile: { type: String, required: true, trim: true },
    },
    shippingaddress: {
      district: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      upzilla: { type: String, default: "", trim: true },
      area: { type: String, default: "", trim: true },
      addressline: { type: String, required: true, trim: true },
      landmark: { type: String, default: "", trim: true },
      locationtext: { type: String, default: "", trim: true },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    payment: {
      method: {
        type: String,
        enum: ["cod", "bkash", "nagad", "bank"],
        default: "cod",
      },
      reference: { type: String, default: "", trim: true },
      note: { type: String, default: "", trim: true },
    },
    notes: { type: String, default: "", trim: true },
    items: { type: [orderItemSchema], default: [] },
    subtotal: { type: Number, required: true, min: 0 },
    deliverytotal: { type: Number, required: true, min: 0 },
    grandtotal: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["placed", "processing", "shipped", "delivered", "returned", "canceled"],
      default: "placed",
      index: true,
    },
    statushistory: { type: [statusHistorySchema], default: [] },
    stocksettledat: {
      type: Date,
      default: null,
      index: true,
    },
    stockrollbackat: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

orderSchema.index({ ownerid: 1, createdAt: -1 });
orderSchema.index({ userid: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("order", orderSchema);

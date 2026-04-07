const mongoose = require("mongoose");

const sellersponsorshipSchema = new mongoose.Schema(
  {
    sellerid: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    shopid: { type: mongoose.Schema.Types.ObjectId, ref: "SellerShop", required: true, index: true },
    itemid: { type: mongoose.Schema.Types.ObjectId, ref: "item", required: true, index: true },
    amount: { type: Number, required: true, min: 100, max: 2000 },
    sponsoreddays: { type: Number, required: true, min: 7 },
    startsat: { type: Date, default: null },
    endsat: { type: Date, default: null },
    senderbkashnumber: { type: String, required: true, trim: true },
    transactionid: { type: String, required: true, trim: true },
    paymentss: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Pending", "Verified", "Rejected"],
      default: "Pending",
      index: true,
    },
    rejectreason: { type: String, default: "", trim: true },
    reviewedby: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedat: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SellerSponsorship", sellersponsorshipSchema);

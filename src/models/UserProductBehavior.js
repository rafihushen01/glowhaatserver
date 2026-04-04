const mongoose = require("mongoose");

const userProductBehaviorSchema = new mongoose.Schema(
  {
    actorid: {
      type: String,
      required: true,
      index: true,
    },
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sessionkey: {
      type: String,
      default: "",
      index: true,
    },
    productid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "item",
      required: true,
      index: true,
    },
    slug: {
      type: String,
      default: "",
      index: true,
    },
    productname: {
      type: String,
      default: "",
    },
    brand: {
      type: String,
      default: "",
      index: true,
    },
    categorytokens: {
      type: [String],
      default: [],
      index: true,
    },
    categoryleaf: {
      type: String,
      default: "",
      index: true,
    },
    pricepoint: {
      type: Number,
      default: 0,
    },
    clickcount: {
      type: Number,
      default: 0,
    },
    detailviewcount: {
      type: Number,
      default: 0,
    },
    wishlistadds: {
      type: Number,
      default: 0,
    },
    wishlistremoves: {
      type: Number,
      default: 0,
    },
    cartadds: {
      type: Number,
      default: 0,
    },
    ordercount: {
      type: Number,
      default: 0,
    },
    orderedqty: {
      type: Number,
      default: 0,
    },
    dwelltotalseconds: {
      type: Number,
      default: 0,
    },
    dwellsessions: {
      type: Number,
      default: 0,
    },
    signalscore: {
      type: Number,
      default: 0,
      index: true,
    },
    lasteventtype: {
      type: String,
      default: "",
    },
    lastinteractedat: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

userProductBehaviorSchema.index({ actorid: 1, productid: 1 }, { unique: true });
userProductBehaviorSchema.index({ productid: 1, signalscore: -1 });

module.exports = mongoose.model("userproductbehavior", userProductBehaviorSchema);

const mongoose = require("mongoose");

const mediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    type: { type: String, enum: ["image", "video"], required: true },
    name: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const sellerChatMessageSchema = new mongoose.Schema(
  {
    senderid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    senderkind: {
      type: String,
      enum: ["user", "guest"],
      required: true,
      default: "user",
    },
    senderguestsessionid: { type: String, default: "", trim: true },
    senderguestname: { type: String, default: "Guest", trim: true },
    senderrole: {
      type: String,
      enum: ["Buyer", "Seller"],
      required: true,
    },
    text: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    media: {
      type: [mediaSchema],
      default: [],
    },
    readbybuyer: {
      type: Boolean,
      default: false,
    },
    readbyseller: {
      type: Boolean,
      default: false,
    },
    isdeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedby: {
      type: String,
      enum: ["buyer", "seller", "admin", ""],
      default: "",
    },
    deletedat: {
      type: Date,
      default: null,
    },
    createdat: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { _id: true }
);

const sellerChatThreadSchema = new mongoose.Schema(
  {
    buyerid: {
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
    guestname: {
      type: String,
      default: "Guest",
      trim: true,
      maxlength: 120,
    },
    sellerid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    shopid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SellerShop",
      required: true,
      index: true,
    },
    productid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "item",
      default: null,
      index: true,
    },
    lastmessage: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    lastmessagedat: {
      type: Date,
      default: Date.now,
      index: true,
    },
    unreadforbuyer: {
      type: Number,
      default: 0,
      min: 0,
    },
    unreadforseller: {
      type: Number,
      default: 0,
      min: 0,
    },
    blockedbybuyer: {
      type: Boolean,
      default: false,
    },
    blockedbyseller: {
      type: Boolean,
      default: false,
    },
    blockreasonbuyer: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    blockreasonseller: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    isactive: {
      type: Boolean,
      default: true,
      index: true,
    },
    messages: {
      type: [sellerChatMessageSchema],
      default: [],
    },
  },
  { timestamps: true }
);

sellerChatThreadSchema.index({ sellerid: 1, lastmessagedat: -1 });
sellerChatThreadSchema.index({ buyerid: 1, lastmessagedat: -1 });
sellerChatThreadSchema.index({ guestsessionid: 1, lastmessagedat: -1 });

module.exports = mongoose.model("SellerChatThread", sellerChatThreadSchema);

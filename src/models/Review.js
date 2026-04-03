const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    productid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "item",
      required: true,
      index: true,
    },
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    orderid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "order",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 2000,
    },
    reviewername: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    revieweremail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      maxlength: 160,
    },
    useplatformemail: {
      type: Boolean,
      default: true,
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length <= 8,
        message: "Maximum 8 review images are allowed",
      },
    },
    isverifiedpurchase: {
      type: Boolean,
      default: true,
      index: true,
    },
    isapproved: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

reviewSchema.index({ productid: 1, userid: 1 }, { unique: true });
reviewSchema.index({ productid: 1, createdAt: -1 });

module.exports = mongoose.model("review", reviewSchema);


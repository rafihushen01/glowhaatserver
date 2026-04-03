const mongoose = require("mongoose");

const productQuestionSchema = new mongoose.Schema(
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
    question: {
      type: String,
      required: true,
      trim: true,
      minlength: 6,
      maxlength: 2000,
    },
    askedbyname: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    askedbyemail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      maxlength: 160,
    },
    isanswered: {
      type: Boolean,
      default: false,
      index: true,
    },
    answertext: {
      type: String,
      default: "",
      trim: true,
      maxlength: 4000,
    },
    answeredby: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    answeredbyname: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    answeredat: {
      type: Date,
      default: null,
    },
    isvisible: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

productQuestionSchema.index({ productid: 1, createdAt: -1 });

module.exports = mongoose.model("productquestion", productQuestionSchema);


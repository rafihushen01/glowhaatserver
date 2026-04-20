const mongoose = require("mongoose");

const navLogoSchema = new mongoose.Schema(
  {
    serialnumber: {
      type: Number,
      required: true,
      index: true,
    },
    logo: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["draft", "active"],
      default: "draft",
      index: true,
    },
    isactive: {
      type: Boolean,
      default: false,
    },
    isdeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    activatedat: {
      type: Date,
      default: null,
    },
    deactivatedat: {
      type: Date,
      default: null,
    },
    uploadedby: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

navLogoSchema.index(
  { isactive: 1 },
  {
    unique: true,
    partialFilterExpression: { isactive: true, isdeleted: false },
  }
);

module.exports = mongoose.model("NavLogo", navLogoSchema);

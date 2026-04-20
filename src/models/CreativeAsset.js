const mongoose = require("mongoose");

const creativeAssetSchema = new mongoose.Schema(
  {
    ownerkind: {
      type: String,
      enum: ["seller", "superadmin"],
      required: true,
      index: true,
    },
    ownerid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: "",
      trim: true,
      maxlength: 220,
      index: true,
    },
    originalname: {
      type: String,
      default: "",
      trim: true,
      maxlength: 280,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    mimetype: {
      type: String,
      default: "",
      trim: true,
      maxlength: 180,
    },
    extension: {
      type: String,
      default: "",
      trim: true,
      maxlength: 40,
    },
    filesize: {
      type: Number,
      default: 0,
      min: 0,
    },
    filekind: {
      type: String,
      enum: ["image", "video", "gif", "pdf", "spreadsheet", "document", "other"],
      default: "other",
      index: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1200,
    },
    isactive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

creativeAssetSchema.index({ ownerkind: 1, ownerid: 1, createdAt: -1 });

module.exports = mongoose.model("CreativeAsset", creativeAssetSchema);

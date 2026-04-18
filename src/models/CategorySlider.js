const mongoose = require("mongoose");

const navPathImageSchema = new mongoose.Schema(
  {
    image: { type: String, default: null },
    link: { type: String, default: "" },
    title: { type: String, default: "" },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const categorySliderSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    media: [
      {
        url: { type: String, default: "" },
        type: { type: String, enum: ["image", "video"], default: "image" },
        order: { type: Number, default: 0 },
      },
    ],

    navlink: {
      type: String,
      default: "",
      trim: true,
    },

    slug: { type: String, required: true, unique: true, index: true },
    order: { type: Number, default: 0 },

    navrootid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Nav",
      default: null,
      index: true,
    },

    segments: [
      {
        navrootid: { type: mongoose.Schema.Types.ObjectId, ref: "Nav" },
        navpath: [
          {
            _id: mongoose.Schema.Types.ObjectId,
            name: String,
            slug: String,
            depth: Number,
            image: { type: String, default: null },
            images: [navPathImageSchema],
          },
        ],
      },
    ],

    type: {
      type: String,
      enum: [
        "slider",
        "shopbycategory",
        "shopbeautyproductbycategory",
        "shopbeautyproductbyconcern",
        "campaign",
        "deals",
        "topbrands",
        "extradiscount",
      ],
      default: "slider",
      index: true,
    },

    status: {
      type: String,
      enum: ["active", "inactive", "draft"],
      default: "inactive",
      index: true,
    },

    // Backward compatibility flags
    isactive: { type: Boolean, default: false },
    deactive: { type: Boolean, default: true },
    isdeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CategorySlider", categorySliderSchema);

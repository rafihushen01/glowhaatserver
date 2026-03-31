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

const categorySliderSchema = new mongoose.Schema({

  name: String,
  media: [
  {
    url: String,
    type: { type: String, enum: ["image", "video"], default: "image" },
    order: { type: Number, default: 0 }
  }
],

  navlink: String,
  slug: { type: String, required: true, unique: true, index: true },
  order: { type: Number, default: 0 },

  // 🔗 CONNECT TO NAV ROOT CATEGORY
  navrootid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Nav",
    required: true,
    index: true
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
      }
    ]
  }
]
,

  type: {
    type: String,
    enum: ["slider", "shopbycategory"],
    default: "slider"
  },

  isactive: { type: Boolean, default: true },
  deactive: { type: Boolean, default: false },
  isdeleted: { type: Boolean, default: false }

}, { timestamps: true });
module.exports = mongoose.model("CategorySlider", categorySliderSchema);

const mongoose = require("mongoose");


// ---------- Image Schema ----------
const navImageSchema = new mongoose.Schema(
  {
    image: String,
    link: String,
    title: String,
    order: { type: Number, default: 0 },
  },
  { _id: true }
);


// ---------- Main Nav Node ----------
const navSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    slug: { type: String, required: true, unique: true, index: true },

    link: { type: String },

    parentid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Nav",
      default: null,
      index: true,
    },

    depth: { type: Number, default: 0 },

    path: { type: String, index: true }, // auto generated full path

    images: [navImageSchema],

    order: { type: Number, default: 0, index: true },

    isactive: { type: Boolean, default: true, index: true },

    isdeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);


// FAST TREE INDEX
navSchema.index({ parentid: 1, order: 1 });

module.exports = mongoose.model("Nav", navSchema);

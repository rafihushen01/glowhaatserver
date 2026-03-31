const mongoose = require("mongoose");

const categoryschema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },

  slug: String,

  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "category",
    default: null,
  },

  level: {
    type: Number,
    default: 0,
  },

  createdat: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("category", categoryschema);

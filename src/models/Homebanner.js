const { default: mongoose } = require("mongoose");

const homebannerSchema = new mongoose.Schema(
  {
    image: {
      type: String,
      default: "",
      trim: true,
    },
    mediatype: {
      type: String,
      enum: ["image", "video"],
      default: "image",
      index: true,
    },
    title: {
      type: String,
      default: "",
      trim: true,
    },
    sectionkey: {
      type: String,
      enum: ["home", "bestselling", "fivestar", "newin"],
      default: "home",
      index: true,
    },
    navigationlink: {
      type: String,
      default: "",
      trim: true,
    },
    bannernumber: {
      type: Number,
      default: 0,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "draft"],
      default: "inactive",
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("homebanner", homebannerSchema);

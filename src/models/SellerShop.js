const mongoose = require("mongoose");

const sellershopSchema = new mongoose.Schema(
  {
    sellerid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    shopname: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    profileimage: { type: String, default: "" },
    bannerimage: { type: String, default: "" },
    description: { type: String, default: "", trim: true },
    contactemail: { type: String, default: "", trim: true, lowercase: true },
    contactphone: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    healthscore: { type: Number, default: 100, min: 0, max: 100 },
    healthisfrozen: { type: Boolean, default: false, index: true },
    freezereason: { type: String, default: "", trim: true },
    blockedat: { type: Date, default: null },
    createdbyadminid: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    badgeids: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SellerBadge" }],
      default: [],
      index: true,
    },
    storelayout: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        sections: ["hero", "featured", "top-selling", "new-in"],
        featuredproductids: [],
        accent: "#1f5c49",
        template: "blank",
        ispublished: false,
        draftlayout: {
          seo: { title: "", description: "" },
          modules: [],
          desktopbanner: "",
          mobilebanner: "",
          desktopprofileimage: "",
          mobileprofileimage: "",
        },
        publishedlayout: {
          seo: { title: "", description: "" },
          modules: [],
          desktopbanner: "",
          mobilebanner: "",
          desktopprofileimage: "",
          mobileprofileimage: "",
        },
        lastpublishedat: null,
        updatedby: null,
        updatedat: null,
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SellerShop", sellershopSchema);

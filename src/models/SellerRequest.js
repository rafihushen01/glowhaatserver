const { default: mongoose } = require("mongoose");

const sellerRequestSchema = new mongoose.Schema(
  {
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },
    fullname: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true, index: true, required: true },
    mobile: { type: String, trim: true, required: true },
    whatsapp: { type: String, trim: true, default: "" },
    dateofbirth: { type: Date, required: true },
    storetype: { type: String, trim: true, required: true },
    preferredcategories: [{ type: String, trim: true }],
    businessname: { type: String, trim: true, required: true },
    businessgmail: { type: String, trim: true, lowercase: true, required: true },
    businessphone: { type: String, trim: true, default: "" },
    sellerloginemail: { type: String, trim: true, lowercase: true, required: true },
    sellerpasswordhash: { type: String, required: true },
    businessmodel: {
      type: String,
      enum: ["Physical Store", "Facebook", "Instagram", "Website", "Mixed"],
      required: true,
    },
    businessdetails: {
      physicalstorename: { type: String, trim: true, default: "" },
      physicalstoreaddress: { type: String, trim: true, default: "" },
      physicalstoredistrict: { type: String, trim: true, default: "" },
      physicalstorecity: { type: String, trim: true, default: "" },
      facebookpagename: { type: String, trim: true, default: "" },
      facebookpagelink: { type: String, trim: true, default: "" },
      instagramidname: { type: String, trim: true, default: "" },
      instagramlink: { type: String, trim: true, default: "" },
      websiteurl: { type: String, trim: true, default: "" },
    },
    pickup: {
      district: { type: String, trim: true, required: true },
      city: { type: String, trim: true, required: true },
      area: { type: String, trim: true, required: true },
      addressline: { type: String, trim: true, default: "" },
      deliverymanphone: { type: String, trim: true, required: true },
    },
    files: {
      storeprofileimage: { type: String, default: "" },
      storebannerimage: { type: String, default: "" },
      physicalstoreimage: { type: String, default: "" },
      niddocfront: { type: String, default: "" },
      niddocback: { type: String, default: "" },
      dateofbirthproof: { type: String, default: "" },
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
      index: true,
    },
    reviewedby: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedat: { type: Date, default: null },
    rejectreason: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

sellerRequestSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model("SellerRequest", sellerRequestSchema);

const { default: mongoose } = require("mongoose");
const bcrypt = require("bcryptjs");

const userschema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      trim: true,
      index: true,
    },

    email: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    password: {
      type: String,
      minlength: 6,
    },

// In your User Model file
mobile: {
  type: String,
  unique: true,
  sparse: true,
// <--- THIS IS THE FIX. It allows multiple 'null' values.
},

    firebaseuid: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    authprovider: {
      type: String,
      enum: ["password", "google", "google+password"],
      default: "password",
    },



    role: {
      type: String,
      enum: ["User", "Seller", "Admin", "SuperAdmin"],
      default: "User",
      index: true,
    },
    issellerverified: {
      type: Boolean,
      default: false,
      index: true,
    },
    sellerapprovedat: {
      type: Date,
    },

    usersignupotp: { type: String },
    usersigninotp: { type: String },
    signinotp: { type: String },
    signinotpexpires: { type: Date },

    issigninotpverified: { type: Boolean, default: false },
    issignupotpverified: { type: Boolean, default: false },

    issignupotpisexpired: { type: Boolean, default: false },
    issigninotpisexpired: { type: Boolean, default: false },

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },

    District: { type: String, index: true },
    city: { type: String, index: true },
    upzilla: { type: String },
    fulladdress: { type: String },

    adminsignupotp: { type: String },
    adminsigninotp: { type: String },

    adminsigninotpisverified: { type: Boolean, default: false },
    adminsignupotpisverified: { type: Boolean, default: false },
    superadminsigninotpisverified: { type: Boolean, default: false },

    adminsignupotpisexpired: { type: Boolean, default: false },
    adminsigninotpisexpired: { type: Boolean, default: false },
    superadminsigninotpisexpired: { type: Boolean, default: false },

    userswishlists: {
      type: String,
      default: "",
    },

    damasktoken: {
      type: Number,
      default: 0,
    },

    usersavatar: {
      type: String,
      default: "",
    },

    maleavatar: {
      type: String,
      default: "/MenAvatar.png",
    },

    femaleavatar: {
      type: String,
      default: "/womenavatar.jpg",
    },

    othergenderavatar: {
      type: String,
      default: "/thirdgenderavatar.webp",
    },

    // 🔥 ENTERPRISE EXTRA FIELDS (ADDED)

    isblocked: {
      type: Boolean,
      default: false,
      index: true,
    },

    isemailverified: {
      type: Boolean,
      default: false,
    },

    lastlogin: {
      type: Date,
    },

    loginip: {
      type: String,
    },

    devicetype: {
      type: String,
      enum: ["Web", "Android", "IOS", "Unknown"],
      default: "Web",
    },

    referralcode: {
      type: String,
      index: true,
    },

    walletbalance: {
      type: Number,
      default: 0,
    },

    totalorders: {
      type: Number,
      default: 0,
    },

    totalspent: {
      type: Number,
      default: 0,
    },

    accountstatus: {
      type: String,
      enum: ["Active", "Suspended", "Deleted"],
      default: "Active",
      index: true,
    },
  },
  { timestamps: true }
);


// 🔐 AUTO HASH PASSWORD (SUPER SECURITY)




// 🔎 PASSWORD COMPARE METHOD




module.exports = mongoose.model("User", userschema);

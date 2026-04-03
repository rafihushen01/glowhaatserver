const mongoose = require("mongoose");

// ================= OPTION =================
const optionschema = new mongoose.Schema({
  name: { type: String, required: true }, // M, L, XL OR 128GB OR 1kg OR Wireless
  baseprice: { type: Number, default: 0 },
  discountpercentage: { type: Number, default: 0 },
  discountprice: { type: Number, default: 0 },
  currentprice: { type: Number, default: 0 },
  discountstartdate: Date,
  discountenddate: Date,
  stock: { type: Number, default: 0 },
  skucode: String,
  weight: String, // grocery support
  expirydate: Date, // food/grocery support
});

// ================= VARIANT =================
const variantschema = new mongoose.Schema({
  name: { type: String, required: true }, // Red, Purple, Wireless, 128GB, Large
  varianttype: String, // color / size / storage / style / weight
  images: { type: [String],  default: [] },
  options: { type: [optionschema], default: [] },
});

// ================= DELIVERY SCHEMA =================
const deliverschema = new mongoose.Schema({
  name: String,
  deliverytime: String,
  deliverycharge: { type: Number, default: 0 },
  isfreeshipping: { type: Boolean, default: false },
});

// ================= MAIN ITEM =================
const itemschema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  flashsale: { type: Boolean, default: false },
  eidsale: { type: Boolean, default: false },
  coustomsale: { type: Boolean, default: false },
  coustomsales: { type: Boolean, default: false }, // legacy mirror
  deliveryschema: deliverschema,
  warranty: String,
  isreturnable: { type: Boolean, default: false },
  warrantyperiod: String,
  warrantynotavalible: { type: Boolean, default: false },
  highlight: String,
  aboutitems: String,
  review: String,
  star: { type: Number, default: 0 },
  reviewcount: { type: Number, default: 0 },
  brand: String,
  whiteimage: String,
  hoverimage: String,
  gallery: { type: [String], default: [] },
category: { type: Array, default: [] },
categorytree: { type: [String], default: [] },
categorypath: { type: String, default: "" },


  type: String, // fashion / electronics / grocery / food
  variants: { type: [variantschema], default: [] },
  isperishable: { type: Boolean, default: false },
  expirydate: Date,
  ingredients: { type: [String], default: [] },
  nutrition: String,
  battery: String,
  capacity:String,
  watt:String,
  gastype:String,
  
  power: String,
  modelnumber: String,
  totalsold: { type: Number, default: 0 },
  isactive: { type: Boolean, default: true },
    slug: {
    type: String,
    lowercase: true,
    unique: true,
    index: true,
  },
  tags: { type: [String], default: [] },
  createdat: { type: Date, default: Date.now },
},{timestamps: true});

// ================= AUTO PRICE ENGINE =================
itemschema.pre("save", function () {
  // Keep both fields synced until old clients are removed.
  if (typeof this.coustomsale === "boolean") {
    this.coustomsales = this.coustomsale;
  } else if (typeof this.coustomsales === "boolean") {
    this.coustomsale = this.coustomsales;
  }

  // Sync safe and production ready
  if (!this.variants?.length) return;

  this.variants.forEach((variant) => {
    if (!variant.options?.length) return;

    variant.options.forEach((opt) => {
      if (opt.baseprice && opt.discountpercentage) {
        opt.discountprice = (opt.baseprice * opt.discountpercentage) / 100;
        opt.currentprice = opt.baseprice - opt.discountprice;
      } else {
        opt.discountprice = 0;
        opt.currentprice = opt.baseprice || 0;
      }
    });
  });
});

module.exports = mongoose.model("item", itemschema);

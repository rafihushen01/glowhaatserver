const mongoose = require("mongoose");

const sellercommissionconfigSchema = new mongoose.Schema(
  {
    globalpercentage: { type: Number, default: 5, min: 0, max: 100 },
    khancommissionpercentage: { type: Number, default: 10, min: 0, max: 100 },
    selleroverrides: {
      type: [
        {
          sellerid: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          percentage: { type: Number, required: true, min: 0, max: 100 },
          note: { type: String, default: "", trim: true },
          updatedat: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SellerCommissionConfig", sellercommissionconfigSchema);

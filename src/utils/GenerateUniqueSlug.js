const slugify = require("../utils/Slugify.js");
const Item = require("../models/Item");

const generateUniqueSlug = async (name, ignoreId = null) => {
  let baseslug = slugify(name || "item");
  if (!baseslug) baseslug = "item";

  let slug = baseslug;
  let counter = 1;

  while (true) {
    const existing = await Item.findOne({ slug }).select("_id").lean();

    if (!existing || (ignoreId && existing._id.toString() === ignoreId.toString())) {
      break;
    }

    slug = `${baseslug}-${counter++}`;
  }

  return slug;
};

module.exports = generateUniqueSlug;

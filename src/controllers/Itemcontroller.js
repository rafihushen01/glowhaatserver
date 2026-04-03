const uploadoncloudinary = require("../utils/Cloudinary.js");
const Item = require("../models/Item.js");
const Category = require("../models/Category.js");
const generateUniqueSlug = require("../utils/GenerateUniqueSlug.js");
const Nav = require("../models/Nav.js");


// ================= CATEGORY TREE BUILDER =================




const buildCategoryTree = async (categoryids) => {
  const categories = await Nav.find({
    _id: { $in: categoryids },
    isactive: true,
    isdeleted: false
  })
    .sort({ depth: 1 }) // ensure depth order
    .lean();

  if (!categories.length) return [];

  let tree = null;
  for (let i = categories.length - 1; i >= 0; i--) {
    const cat = categories[i];
    tree = {
      name: cat.name,
      link: cat.link || cat.path,
      children: tree ? [tree] : []
    };
  }

  return [tree]; // wrap in array for consistency
};
const slugToCategoryName = (slug) => {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }

  if (value === null || value === undefined) return fallback;
  return Boolean(value);
};

const normalizeBooleanFields = (body, fieldDefaults) => {
  Object.entries(fieldDefaults).forEach(([field, fallback]) => {
    if (hasOwn(body, field)) {
      body[field] = parseBoolean(body[field], fallback);
      return;
    }

    body[field] = fallback;
  });
};





exports.createItem = async (req, res) => {
  try {
    let body = { ...req.body };

    // ===== SAFE JSON PARSING =====
    const safejson = (data, def) => {
      try {
        if (!data) return def;
        if (typeof data === "object") return data;
        return JSON.parse(data);
      } catch {
        return def;
      }
    };

    body.variants = safejson(body.variants, []);
    body.gallery = safejson(body.gallery, []);
    body.categoryids = safejson(body.categoryids, []);
    body.deliveryschema = safejson(body.deliveryschema, {});

    normalizeBooleanFields(body, {
      flashsale: false,
      eidsale: false,
      coustomsale: false,
      isreturnable: false,
      isperishable: false,
      warrantynotavalible: false,
      isactive: true,
    });

    body.coustomsales = body.coustomsale;

    // ===== CATEGORY RESOLUTION =====
    if (body.categoryids?.length) {
      body.category = await buildCategoryTree(body.categoryids);
    }
    // ===== FILE MAPPING =====
    const fileMap = {};
    (req.files || []).forEach(f => {
      fileMap[f.fieldname] = fileMap[f.fieldname] || [];
      fileMap[f.fieldname].push(f);
    });

    const uploadFile = async (file) => {
      try { return await uploadoncloudinary(file.path); } 
      catch (err) { console.error("Cloudinary failed", file.originalname, err); return null; }
    };

    // ===== MAIN IMAGES =====
    const mainImages = ["whiteimage", "hoverimage"];
    await Promise.all(mainImages.map(async key => {
      if (fileMap[key]?.[0]) {
        const url = await uploadFile(fileMap[key][0]);
        if (url) body[key] = url;
      }
    }));

    // ===== GALLERY =====
    if (fileMap.gallery?.length) {
      const galleryUrls = await Promise.all(fileMap.gallery.map(uploadFile));
      body.gallery = galleryUrls.filter(Boolean);
    }

    // ===== VARIANTS MEDIA =====
    if (body.variants?.length) {
      let variantIndex = 0;
      for (let v of body.variants) {
        const need = v.images?.length || 0;
        const filesForVariant = [];
        for (let i = 0; i < need; i++) {
          const key = `variantmedia_${variantIndex}_${i}`;
          filesForVariant.push(...(fileMap[key] || []));
        }
        if (filesForVariant.length) {
          const urls = await Promise.all(filesForVariant.map(uploadFile));
          v.images = urls.filter(Boolean);
        }
        variantIndex++;
      }
    }

    // ===== GENERATE UNIQUE SLUG =====
    body.slug = await generateUniqueSlug(body.name);

    // ===== CREATE ITEM =====
    const item = await Item.create(body);

    return res.status(201).json({
      success: true,
      message: "ITEM CREATED Successfully 🚀",
      item,
    });

  } catch (error) {
    console.error("CREATE ITEM ERROR:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: error.message || "Unknown error",
      });
    }
  }
};


exports.edititem = async (req, res) => {
  try {
    const { id } = req.params;
    let body = { ...req.body };

    if (typeof body.variants === "string")
      body.variants = JSON.parse(body.variants);

    if (req.files?.whiteimage)
      body.whiteimage = await uploadoncloudinary(
        req.files.whiteimage[0].path
      );

    if (req.files?.hoverimage)
      body.hoverimage = await uploadoncloudinary(
        req.files.hoverimage[0].path
      );
         if (body.name && body.name !== item.name) {
      body.slug = await generateUniqueSlug(body.name, id);
    }

    const updated = await Item.findByIdAndUpdate(id, body, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Item updated",
      item: updated,
    });
  } catch (error) {
     console.error("CREATE ITEM ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create item",
      error: error.message,
    });
  }
};
exports.deleteitem = async (req, res) => {
  try {
    const { id } = req.params;

    await Item.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Item deleted",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
exports.getallitems = async (req, res) => {
  try {
    const { category, subcategory, search } = req.query;

    let filter = {};

    if (category) filter.category = category;
    if (subcategory) filter.subcategory = subcategory;

    if (search)
      filter.name = { $regex: search, $options: "i" };

    const items = await Item.find(filter).sort({ createdat: -1 });

    res.json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.searchitems = async (req, res) => {
  try {
    const raw = String(req.query?.q || "").trim();
    if (!raw) {
      return res.status(200).json({ success: true, count: 0, items: [] });
    }

    const safe = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(safe, "i");

    const items = await Item.find({
      isactive: true,
      $or: [
        { name: regex },
        { brand: regex },
        { categorypath: regex },
        { tags: regex },
      ],
    })
      .sort({ createdat: -1 })
      .limit(12)
      .lean();

    return res.status(200).json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};


exports.getnewinitems = async (req, res) => {
  try {
    const days = 5;

    const date = new Date();
    date.setDate(date.getDate() - days);

    const items = await Item.find({
      createdat: { $gte: date },
      isactive: true
    }).sort({ createdat: -1 });

    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success:false, message: err.message });
  }
};
exports.getitem = async (req, res) => {
  try {
    const { slug } = req.params;

    const item = await Item.findOne({ slug });

    if (!item) {
      return res.json({ success: false, message: "Item not found" });
    }

    res.json({ success: true, item });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};
exports.shopbycategory = async (req, res) => {
  try {
    const { slug } = req.params;
    const categoryName = slugToCategoryName(slug);   // ✅ FIX

    const products = await Item.find({
      categorypath: { $regex: categoryName, $options: "i" }, // ✅ FIX
      isactive: true,
    })
      .select("-__v")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error("shopbycategory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load category products",
    });
  }
};

// ================= CATEGORY FILTER DATA =================
exports.getcategoryfilters = async (req, res) => {
  try {
    const { slug } = req.params;
    const categoryName = slugToCategoryName(slug);

    const products = await Item.find({
      categorypath: { $regex: categoryName, $options: "i" },
      isactive: true,
    }).lean();

    let colors = new Set();
    let sizes = new Set();
    let prices = [];

    products.forEach((product) => {
      // 1️⃣ Direct/base price support
      if (product.price != null) prices.push(Number(product.price));
      if (product.baseprice != null) prices.push(Number(product.baseprice));
      if (product.sellingprice != null) prices.push(Number(product.sellingprice));

      product.variants?.forEach((variant) => {
        const type = variant.varianttype?.toLowerCase();

        // 2️⃣ COLOR (case-insensitive)
        if (type?.includes("color")) {
          if (variant.name) colors.add(variant.name.trim());
        }

        // 3️⃣ SIZE
        if (type?.includes("size")) {
          variant.options?.forEach((opt) => {
            if (opt.name) sizes.add(opt.name.trim());

            if (opt.currentprice != null) {
              prices.push(Number(opt.currentprice));
            }
          });
        }

        // 4️⃣ If variant has price but not size type
        variant.options?.forEach((opt) => {
          if (opt.currentprice != null) {
            prices.push(Number(opt.currentprice));
          }
        });
      });
    });

    // Remove invalid prices
    prices = prices.filter((p) => !isNaN(p) && p >= 0);

    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;

    return res.status(200).json({
      success: true,
      filters: {
        colors: [...colors].sort(),
        sizes: [...sizes].sort(),
        minPrice,
        maxPrice,
      },
      debug: {
        totalProducts: products.length,
        totalPricesCollected: prices.length,
      },
    });
  } catch (error) {
    console.error("getcategoryfilters error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to build filters",
    });
  }
};

// ================= FILTER CATEGORY PRODUCTS =================
exports.filtercategoryproduct = async (req, res) => {
  try {
  const { slug } = req.params;
const categoryName = slugToCategoryName(slug);  
    const { colors, sizes, minprice, maxprice, sort } = req.body;

  const products = await Item.find({
  categorypath: { $regex: categoryName, $options: "i" }, // ✅
  isactive: true,
}).lean();

    let filtered = products.filter((product) => {
      let colorMatch = !colors?.length;
      let sizeMatch = !sizes?.length;
    let priceMatch = !minprice && !maxprice;


if (opt.currentprice != null) {
  const price = Number(opt.currentprice);
  if (
    (!minprice || price >= minprice) &&
    (!maxprice || price <= maxprice)
  ) {
    priceMatch = true;
  }
}


      product.variants?.forEach((variant) => {
        // COLOR MATCH
        if (colors?.length && variant.varianttype === "color") {
          if (colors.includes(variant.name)) colorMatch = true;
        }

        // SIZE + PRICE MATCH
        if (variant.varianttype === "size") {
          variant.options?.forEach((opt) => {
            if (sizes?.length && sizes.includes(opt.name)) {
              sizeMatch = true;
            }

            if (
              (minprice || maxprice) &&
              opt.currentprice >= (minprice || 0) &&
              opt.currentprice <= (maxprice || Infinity)
            ) {
              priceMatch = true;
            }
          });
        }
      });

      return colorMatch && sizeMatch && priceMatch;
    });

    // SORTING
    if (sort === "price_low_high") {
      filtered.sort(
        (a, b) =>
          (a.variants?.[0]?.options?.[0]?.currentprice || 0) -
          (b.variants?.[0]?.options?.[0]?.currentprice || 0)
      );
    }

    if (sort === "price_high_low") {
      filtered.sort(
        (a, b) =>
          (b.variants?.[0]?.options?.[0]?.currentprice || 0) -
          (a.variants?.[0]?.options?.[0]?.currentprice || 0)
      );
    }

    if (sort === "newest") {
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    return res.status(200).json({
      success: true,
      count: filtered.length,
      data: filtered,
    });
  } catch (error) {
    console.error("filtercategoryproduct error:", error);
    return res.status(500).json({
      success: false,
      message: "Filtering failed",
    });
  }
};

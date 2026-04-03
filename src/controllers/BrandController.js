const sanitize = require("mongo-sanitize");
const Brand = require("../models/Brand");
const slugify = require("../utils/Slugify");

const normalizeText = (value = "") => String(value).trim();

exports.createbrand = async (req, res) => {
  try {
    const payload = sanitize(req.body || {});
    const name = normalizeText(payload.name);
    const description = normalizeText(payload.description);
    const logo = normalizeText(payload.logo);

    if (!name) {
      return res.status(400).json({ success: false, message: "Brand name is required" });
    }

    const base = slugify(name);
    let slug = base;
    let counter = 1;
    while (await Brand.exists({ slug })) {
      slug = `${base}-${counter++}`;
    }

    const created = await Brand.create({
      name,
      slug,
      description,
      logo,
      isactive: true,
      isdeleted: false,
    });

    return res.status(201).json({
      success: true,
      message: "Brand created successfully",
      brand: created,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to create brand",
      error: error.message,
    });
  }
};

exports.editbrand = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = sanitize(req.body || {});
    const brand = await Brand.findById(id);

    if (!brand) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    if (payload.name) {
      const nextname = normalizeText(payload.name);
      if (nextname && nextname !== brand.name) {
        const base = slugify(nextname);
        let slug = base;
        let counter = 1;
        while (await Brand.exists({ slug, _id: { $ne: id } })) {
          slug = `${base}-${counter++}`;
        }
        brand.name = nextname;
        brand.slug = slug;
      }
    }

    if (payload.description !== undefined) {
      brand.description = normalizeText(payload.description);
    }
    if (payload.logo !== undefined) {
      brand.logo = normalizeText(payload.logo);
    }
    if (payload.isactive !== undefined) {
      brand.isactive = Boolean(payload.isactive);
    }

    await brand.save();

    return res.status(200).json({
      success: true,
      message: "Brand updated successfully",
      brand,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update brand",
      error: error.message,
    });
  }
};

exports.deletebrand = async (req, res) => {
  try {
    const { id } = req.params;
    const brand = await Brand.findById(id);

    if (!brand) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    brand.isdeleted = true;
    brand.isactive = false;
    await brand.save();

    return res.status(200).json({
      success: true,
      message: "Brand deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete brand",
      error: error.message,
    });
  }
};

exports.getbrands = async (req, res) => {
  try {
    const brands = await Brand.find({ isactive: true, isdeleted: false })
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: brands.length,
      brands,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch brands",
      error: error.message,
    });
  }
};

exports.getbrandbyslug = async (req, res) => {
  try {
    const { slug } = req.params;
    const brand = await Brand.findOne({
      slug: String(slug || "").toLowerCase(),
      isactive: true,
      isdeleted: false,
    }).lean();

    if (!brand) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    return res.status(200).json({ success: true, brand });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch brand",
      error: error.message,
    });
  }
};


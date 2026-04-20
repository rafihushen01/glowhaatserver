const uploadoncloudinary = require("../utils/Cloudinary.js");
const Nav = require("../models/Nav.js");
const NavLogo = require("../models/NavLogo.js");
const slugify=require("../utils/Slugify.js");
const getlogoFile = (req) => {
  if (req.file) return req.file;

  if (Array.isArray(req.files) && req.files.length) {
    return req.files[0];
  }

  return null;
};

const getAllLogoFiles = (req) => {
  if (Array.isArray(req.files) && req.files.length) return req.files;
  const single = getlogoFile(req);
  return single ? [single] : [];
};

const normalizeLogoRecord = (logo) => ({
  _id: logo._id,
  serialnumber: logo.serialnumber,
  logo: logo.logo,
  status: logo.status,
  isactive: logo.isactive,
  isdeleted: logo.isdeleted,
  activatedat: logo.activatedat,
  deactivatedat: logo.deactivatedat,
  createdAt: logo.createdAt,
  updatedAt: logo.updatedAt,
});

const getNextSerialSeed = async () => {
  const latest = await NavLogo.findOne({}).sort({ serialnumber: -1 }).select("serialnumber").lean();
  return Number(latest?.serialnumber || 0);
};

const getNavPath = async (navid) => {
  const path = [];
  let current = await Nav.findById(navid).lean();

  while (current) {
    path.unshift({
      _id: current._id,
      name: current.name,
      slug: current.slug,
      depth: current.depth,
    });

    if (!current.parentid) break;
    current = await Nav.findById(current.parentid).lean();
  }

  return path;
};


// ===============================
// CREATE NAV LINK
// ===============================

exports.createnav = async (req, res) => {
  // console.log("\n\n==================================================");
  // console.log("🚀 CREATE NAV REQUEST RECEIVED");
  // console.log("==================================================");

  try {
    const { name, link, parentid } = req.body;
    
    // DEBUG: Log Raw Body
    // console.log("📝 BODY NAME:", name);
    // console.log("📝 BODY LINK:", link);
    // console.log("📂 FILES RECEIVED:", req.files ? req.files.length : 0);

    // 1. Validation
    if (!name) {
      console.log("❌ ERROR: Name is missing");
      return res.status(400).json({ success: false, message: "Name required" });
    }

    // 2. Generate Slug
    let baseslug = slugify(name, { lower: true, strict: true });
    let slug = baseslug;
    let counter = 1;
    while (await Nav.exists({ slug })) {
      slug = `${baseslug}-${counter++}`;
    }

    // 3. Path & Depth Logic
    let depth = 0;
    let path = `/${slug}`;

    if (parentid) {
      const parent = await Nav.findById(parentid);
      if (!parent) {
        console.log("❌ ERROR: Parent ID provided but not found in DB");
        return res.status(404).json({ success: false, message: "Parent not found" });
      }
      depth = parent.depth + 1;
      path = `${parent.path}/${slug}`;
    }

    // 4. Initialize Nav Object
    const nav = new Nav({
      name,
      slug,
      link: link || path,
      parentid: parentid || null,
      depth,
      path,
      images: [] 
    });

    // 5. ⚡ SUPER POWERFUL IMAGE PROCESSING ⚡
    if (req.body.imagesMeta) {
      console.log("🔍 PARSING IMAGE METADATA...");
      
      let imagesMeta = [];
      try {
        imagesMeta = JSON.parse(req.body.imagesMeta);
        console.log(`✅ METADATA PARSED: Found ${imagesMeta.length} items`);
      } catch (err) {
        console.log("❌ JSON PARSE ERROR:", err);
        return res.status(400).json({ success: false, message: "Invalid JSON in imagesMeta" });
      }

      // Check if file count matches 'new' meta count
      const newImageMetas = imagesMeta.filter(m => m.type === "new");
      const uploadedFiles = req.files || [];

      if (newImageMetas.length !== uploadedFiles.length) {
        console.warn(`⚠️ WARNING: Mismatch! Meta expects ${newImageMetas.length} new files, but got ${uploadedFiles.length} files.`);
      }

      let fileCursor = 0; // Pointer to grab files from req.files array

      // Execute uploads in parallel
      const processedImages = await Promise.all(
        imagesMeta.map(async (meta, index) => {
          
          // --- SCENARIO A: NEW IMAGE ---
          if (meta.type === "new") {
            const file = uploadedFiles[fileCursor];
            fileCursor++; // Move to next file for the next loop iteration

            if (!file) {
              console.log(`❌ [Item ${index}] ERROR: No file found in req.files at index ${fileCursor - 1}`);
              return null; // Skip this bad data
            }

            console.log(`📤 [Item ${index}] UPLOADING TO CLOUDINARY: ${file.originalname}`);

            try {
              // CALL YOUR EXISTING UTILITY
              const cloudUrl = await uploadoncloudinary(file.path);
              
              console.log(`✅ [Item ${index}] UPLOAD SUCCESS: ${cloudUrl}`);
              
              return {
                image: cloudUrl,
                link: meta.link || "",
                title: meta.title || "",
                order: index // Keep original order
              };
            } catch (uploadErr) {
              console.error(`🔥 [Item ${index}] CLOUDINARY FAILED:`, uploadErr.message);
              return null; // Strict: Don't save broken image data
            }
          }

          // --- SCENARIO B: EXISTING IMAGE ---
          else if (meta.type === "existing") {
            console.log(`♻️ [Item ${index}] KEEPING EXISTING URL`);
            return {
              image: meta.image,
              link: meta.link || "",
              title: meta.title || "",
              order: index
            };
          }

          return null; // Should not happen
        })
      );

      // 6. Final Data Cleanup (Remove Nulls)
      nav.images = processedImages.filter(img => img !== null);
      console.log(`💾 FINAL IMAGES TO SAVE: ${nav.images.length}`);
    }

    // 7. Save to MongoDB
    await nav.save();
    console.log("✅ NAV NODE SAVED TO MONGODB SUCCESSFULLY");
    console.log("==================================================\n");

    res.status(201).json({ success: true, data: nav });

  } catch (error) {
    console.error("🔥 FATAL CONTROLLER ERROR:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};


// delete nav link
const deleteRecursive = async (id) => {
  const node = await Nav.findById(id);
  if (!node) return;

  node.isdeleted = true;
  node.isactive = false;
  await node.save();

  const children = await Nav.find({ parentid: id });
  for (const child of children) {
    await deleteRecursive(child._id);
  }
};

exports.deletenav = async (req, res) => {
  try {
    await deleteRecursive(req.params.id);
    res.json({ success: true, message: "Deleted recursively" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===============================
// EDIT NAV LINK
// ===============================
const updateChildrenDepth = async (node) => {
  const children = await Nav.find({ parentid: node._id, isdeleted: false });

  for (const child of children) {
    child.depth = node.depth + 1;
    child.path = `${node.path}/${child.slug}`;
    await child.save();
    await updateChildrenDepth(child);
  }
};

exports.editnav = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, link, parentid, imagelink, title, isactive } = req.body;

    const nav = await Nav.findById(id);
    if (!nav) return res.status(404).json({ success: false, message: "Nav not found" });

    if (name) nav.name = name;
    if (typeof isactive !== "undefined") nav.isactive = isactive;

    if (parentid) {
      const parent = await Nav.findById(parentid);
      if (!parent) return res.status(404).json({ success: false, message: "Parent not found" });

      nav.parentid = parentid;
      nav.depth = parent.depth + 1;
      nav.path = `${parent.path}/${nav.slug}`;
    }

    if (link) nav.link = link;

if (req.files && req.files.length > 0) {

  nav.images = []; // remove old images

  for (const file of req.files) {
    const imageurl = await uploadoncloudinary(file.path);

    nav.images.push({
      image: imageurl,
      link: imagelink || "",
      title: title || "",
    });
  }
}



    await nav.save();
    await updateChildrenDepth(nav);

    res.json({ success: true, data: nav });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};




// ===============================
// UPLOAD LOGO
// ===============================
exports.uploadlogo = async (req, res) => {
  try {
    const files = getAllLogoFiles(req);
    if (!files.length) {
      return res.status(400).json({
        success: false,
        message: "Logo file missing",
      });
    }

    const serialSeed = await getNextSerialSeed();
    const uploaded = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const logourl = await uploadoncloudinary(file.path);
      const created = await NavLogo.create({
        serialnumber: serialSeed + index + 1,
        logo: logourl,
        status: "draft",
        isactive: false,
        uploadedby: req.user?.userId || null,
      });
      uploaded.push(normalizeLogoRecord(created));
    }

    return res.status(201).json({
      success: true,
      message: `${uploaded.length} logo draft uploaded successfully.`,
      logos: uploaded,
    });
  } catch (error) {
    console.log("LOGO UPLOAD ERROR:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// ===============================
// EDIT LOGO
// ===============================
exports.editlogo = async (req, res) => {
  return exports.uploadlogo(req, res);
};

exports.uploadlogosbulk = async (req, res) => {
  return exports.uploadlogo(req, res);
};

exports.getAdminLogos = async (_req, res) => {
  try {
    const logos = await NavLogo.find({ isdeleted: false })
      .sort({ isactive: -1, serialnumber: 1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: logos.length,
      logos: logos.map(normalizeLogoRecord),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch logos." });
  }
};

exports.getActiveLogo = async (_req, res) => {
  try {
    const logo = await NavLogo.findOne({ isactive: true, isdeleted: false })
      .sort({ updatedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      hasactive: Boolean(logo),
      logo: logo ? normalizeLogoRecord(logo) : null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch active logo." });
  }
};

exports.activateLogo = async (req, res) => {
  try {
    const logoId = req.params.id;
    const target = await NavLogo.findById(logoId);

    if (!target || target.isdeleted) {
      return res.status(404).json({ success: false, message: "Logo not found." });
    }

    if (target.isactive) {
      return res.status(200).json({
        success: true,
        message: "Logo is already active.",
        logo: normalizeLogoRecord(target),
      });
    }

    const existingActive = await NavLogo.findOne({
      _id: { $ne: target._id },
      isactive: true,
      isdeleted: false,
    })
      .select("_id serialnumber")
      .lean();

    if (existingActive) {
      return res.status(409).json({
        success: false,
        message: "First deactivate the current active logo, then activate your desired logo.",
        activeLogo: existingActive,
      });
    }

    target.isactive = true;
    target.status = "active";
    target.activatedat = new Date();
    target.deactivatedat = null;
    await target.save();

    return res.status(200).json({
      success: true,
      message: "Logo activated successfully.",
      logo: normalizeLogoRecord(target),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "First deactivate the current active logo, then activate your desired logo.",
      });
    }
    return res.status(500).json({ success: false, message: "Failed to activate logo." });
  }
};

exports.deactivateLogo = async (req, res) => {
  try {
    const logoId = req.params.id;
    const target = await NavLogo.findById(logoId);

    if (!target || target.isdeleted) {
      return res.status(404).json({ success: false, message: "Logo not found." });
    }

    if (!target.isactive) {
      return res.status(400).json({
        success: false,
        message: "This logo is already inactive.",
      });
    }

    target.isactive = false;
    target.status = "draft";
    target.deactivatedat = new Date();
    await target.save();

    return res.status(200).json({
      success: true,
      message: "Logo deactivated successfully.",
      logo: normalizeLogoRecord(target),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to deactivate logo." });
  }
};

exports.deleteLogoDraft = async (req, res) => {
  try {
    const logoId = req.params.id;
    const target = await NavLogo.findById(logoId);

    if (!target || target.isdeleted) {
      return res.status(404).json({ success: false, message: "Logo not found." });
    }

    if (target.isactive) {
      return res.status(400).json({
        success: false,
        message: "Active logo cannot be deleted. Deactivate it first.",
      });
    }

    target.isdeleted = true;
    target.status = "draft";
    await target.save();

    return res.status(200).json({ success: true, message: "Draft logo deleted successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to delete logo." });
  }
};

// ===============================
// GET ALL NAV (PUBLIC)
// ===============================
exports.getnav = async (req, res) => {
  try {
    const items = await Nav.find({
      isdeleted: false,   // keep only this filter
    })
      .sort({ depth: 1, order: 1 }) // VERY IMPORTANT
      .lean();

    const map = new Map();
    const roots = [];

    // STEP 1 — create nodes
    for (const item of items) {
      map.set(String(item._id), {
        ...item,
        children: [],
      });
    }

    // STEP 2 — attach children safely
    for (const item of items) {
      const id = String(item._id);
      const parentid = item.parentid ? String(item.parentid) : null;

      if (parentid && map.has(parentid)) {
        map.get(parentid).children.push(map.get(id));
      } else {
        roots.push(map.get(id));
      }
    }

    return res.json({
      success: true,
      count: items.length,
      treeDepth: Math.max(...items.map(i => i.depth || 0)),
      data: roots,
    });

  } catch (error) {
    console.error("NAV TREE ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


exports.getCategoryByDepth = async (req, res) => {
  try {
    const { depth, parentid } = req.query;

    if (typeof depth === "undefined") {
      return res.status(400).json({
        success: false,
        message: "Depth is required",
      });
    }

    const query = {
      depth: Number(depth),
      isactive: true,
      isdeleted: false,
    };

    if (parentid) query.parentid = parentid;

    const categories = await Nav.find(query)
      .sort({ order: 1, name: 1 }) // keep predictable order
      .lean();

    res.status(200).json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error) {
    console.error("🔥 GET CATEGORY BY DEPTH ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


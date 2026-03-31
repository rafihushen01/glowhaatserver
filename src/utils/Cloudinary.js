const cloudinary = require("cloudinary").v2;
const dotenv = require("dotenv");
const fs = require("fs");

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API,
  api_secret: process.env.CLOUD_SECRET,
});

const removetempfile = (filepath) => {
  if (!filepath) return;

  try {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  } catch (cleanuperror) {
    console.error("Temp file cleanup failed:", cleanuperror.message);
  }
};

const uploadoncloudinary = async (filepath) => {
  if (!filepath) {
    throw new Error("File path is required for upload");
  }

  try {
    const result = await cloudinary.uploader.upload(filepath, {
      resource_type: "auto",
    });

    return result.secure_url;
  } catch (error) {
    console.error("Cloudinary upload failed:", error.message);
    throw error;
  } finally {
    removetempfile(filepath);
  }
};

module.exports = uploadoncloudinary;

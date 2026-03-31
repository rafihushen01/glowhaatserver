// SUPER SAFE SLUG GENERATOR (supports messy admin input)
const slugify = (text = "") => {
  return text
    .toString()
    .normalize("NFKD")                 // remove unicode weird chars
    .replace(/[\u0300-\u036f]/g, "")   // remove accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")       // replace spaces + symbols → -
    .replace(/^-+|-+$/g, "")           // remove starting/ending -
    .replace(/-{2,}/g, "-");           // remove duplicate -
};

module.exports = slugify;

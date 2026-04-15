const { default: mongoose } = require("mongoose");

const homebannerschema=new mongoose.Schema({
  image:{

    type:String,
    path:String, // cloudinary url
  },
  sectionkey: {
    type: String,
    enum: ["home", "bestselling", "fivestar"],
    default: "home",
    index: true,
  },
  navigationlink:{


    type:String,
    trim:true,
  },
  bannernumber:{
    type:Number
  }






},{timestamps:true})
module.exports=mongoose.model("homebanner",homebannerschema)

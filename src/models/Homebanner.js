const { default: mongoose } = require("mongoose");

const homebannerschema=new mongoose.Schema({
  image:{

    type:String,
    path:String, // cloudinary url
  },
  navigationlink:{


    type:String,
    trim:true,
  },
  bannernumber:{
    type:Number
  }






})
module.exports=mongoose.model("homebanner",homebannerschema)
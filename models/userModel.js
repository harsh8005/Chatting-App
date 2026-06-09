const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name:{
        type:String,
        required:true
    },
    email:{
        type:String,
        required:true
    },
    image:{
        type:String,
        required:true
    },
    password:{
        type:String,
        required:true
    },
    is_online:{
        type:String,
        default:'0'
    }
},
{ timestamps:true}
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ name: 'text', email: 'text' });

module.exports = mongoose.model('User', userSchema );

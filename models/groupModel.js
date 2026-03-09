const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({

    creator_id:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'User',
        required:true
    },
    name:{
        type:String,
        required:true
    },
    image:{
        type:String,
        default:''
    },
    limit:{
        type:Number,
        required:true,
        min:2
    },
    members:{
        type:[mongoose.Schema.Types.Mixed],
        default:[]
    },
    ai_tags: {
        type: [String],
        default: []
    },
    ai_last_recap: {
        type: String,
        default: ''
    }

},
{ timestamps:true}
);

groupSchema.index({ name: 'text' });
groupSchema.index({ creator_id: 1, updatedAt: -1 });

module.exports = mongoose.model('Group', groupSchema );

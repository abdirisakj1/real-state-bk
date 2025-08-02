const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  clientName: { type: String, required: true },
  email: String,
  phone: String,
  property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' },
  transactionType: { type: String, enum: ['rent', 'buy'], default: 'rent' },
  budget: String,
  moveInDate: String,
  leaseDuration: String,
  notes: String,
  status: { type: String, default: 'active' },
  preferences: {
    bedrooms: String,
    bathrooms: String,
    petFriendly: Boolean,
    furnished: Boolean,
    parking: Boolean
  }
}, { timestamps: true });

module.exports = mongoose.model('Client', clientSchema);

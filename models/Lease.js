const mongoose = require('mongoose');

const leaseSchema = new mongoose.Schema({
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  },
  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  monthlyRent: {
    type: Number,
    required: true,
    min: 0
  },
  securityDeposit: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'terminated', 'pending', 'renewed'],
    default: 'pending'
  },
  leaseTerms: {
    type: String,
    required: true
  },
  paymentDueDate: {
    type: Number,
    required: true,
    min: 1,
    max: 31,
    default: 1
  },
  lateFee: {
    amount: { type: Number, default: 0 },
    gracePeriod: { type: Number, default: 5 } // days
  },
  utilities: {
    water: { type: Boolean, default: false },
    electricity: { type: Boolean, default: false },
    gas: { type: Boolean, default: false },
    internet: { type: Boolean, default: false },
    cable: { type: Boolean, default: false },
    trash: { type: Boolean, default: false }
  },
  petDeposit: {
    type: Number,
    default: 0
  },
  additionalCharges: [{
    description: String,
    amount: Number,
    frequency: { type: String, enum: ['monthly', 'one-time'], default: 'monthly' }
  }],
  renewalNotice: {
    sent: { type: Boolean, default: false },
    sentDate: { type: Date, default: null },
    response: { type: String, enum: ['renew', 'terminate', 'pending'], default: 'pending' }
  },
  documents: [{
    name: String,
    url: String,
    uploadDate: { type: Date, default: Date.now }
  }],
  notes: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Virtual for lease duration in months
leaseSchema.virtual('durationMonths').get(function() {
  const start = new Date(this.startDate);
  const end = new Date(this.endDate);
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24 * 30));
});

// Virtual for days remaining
leaseSchema.virtual('daysRemaining').get(function() {
  const today = new Date();
  const end = new Date(this.endDate);
  const diffTime = end - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Check if lease is expired
leaseSchema.virtual('isExpired').get(function() {
  return new Date() > new Date(this.endDate);
});

// Check if renewal notice is due (60 days before expiry)
leaseSchema.virtual('isRenewalNoticeDue').get(function() {
  const today = new Date();
  const noticeDate = new Date(this.endDate);
  noticeDate.setDate(noticeDate.getDate() - 60);
  return today >= noticeDate && !this.renewalNotice.sent;
});

module.exports = mongoose.model('Lease', leaseSchema);

const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  lease: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lease',
    required: false // Now optional; payments can be created without a lease
  },
  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentType: {
    type: String,
    enum: ['rent', 'security_deposit', 'late_fee', 'pet_deposit', 'utility', 'maintenance', 'other'],
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'check', 'bank_transfer', 'credit_card', 'online', 'other'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded', 'partial'],
    default: 'pending'
  },
  dueDate: {
    type: Date,
    required: true
  },
  paidDate: {
    type: Date,
    default: null
  },
  lateFee: {
    type: Number,
    default: 0
  },
  description: {
    type: String,
    trim: true
  },
  transactionId: {
    type: String,
    unique: true,
    sparse: true
  },
  receiptNumber: {
    type: String,
    unique: true,
    sparse: true
  },
  invoiceGenerated: {
    type: Boolean,
    default: false
  },
  invoiceUrl: {
    type: String,
    default: null
  },
  notes: {
    type: String,
    default: ''
  },
  attachments: [{
    name: String,
    url: String,
    uploadDate: { type: Date, default: Date.now }
  }],
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringPeriod: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly'],
    default: null
  },
  nextDueDate: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Virtual for overdue status
paymentSchema.virtual('isOverdue').get(function() {
  return this.status === 'pending' && new Date() > new Date(this.dueDate);
});

// Virtual for days overdue
paymentSchema.virtual('daysOverdue').get(function() {
  if (!this.isOverdue) return 0;
  const today = new Date();
  const due = new Date(this.dueDate);
  return Math.ceil((today - due) / (1000 * 60 * 60 * 24));
});

// Generate unique receipt number
paymentSchema.pre('save', function(next) {
  if (!this.receiptNumber && this.status === 'completed') {
    this.receiptNumber = `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }
  next();
});

// Index for efficient queries
paymentSchema.index({ tenant: 1, dueDate: -1 });
paymentSchema.index({ property: 1, dueDate: -1 });
paymentSchema.index({ status: 1, dueDate: 1 });

module.exports = mongoose.model('Payment', paymentSchema);

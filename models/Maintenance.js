const mongoose = require('mongoose');

const maintenanceSchema = new mongoose.Schema({
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  },
  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'cosmetic', 'security', 'other'],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'emergency'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'cancelled', 'on_hold'],
    default: 'pending'
  },
  estimatedCost: {
    type: Number,
    min: 0,
    default: 0
  },
  actualCost: {
    type: Number,
    min: 0,
    default: 0
  },
  scheduledDate: {
    type: Date,
    default: null
  },
  completedDate: {
    type: Date,
    default: null
  },
  images: [{
    url: String,
    caption: String,
    uploadDate: { type: Date, default: Date.now }
  }],
  notes: [{
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  vendorInfo: {
    name: String,
    contact: String,
    email: String,
    cost: Number
  },
  isUrgent: {
    type: Boolean,
    default: false
  },
  tenantAccess: {
    required: { type: Boolean, default: true },
    scheduledTime: { type: Date, default: null },
    confirmed: { type: Boolean, default: false }
  }
}, {
  timestamps: true
});

// Virtual for days since request
maintenanceSchema.virtual('daysSinceRequest').get(function() {
  const today = new Date();
  const created = new Date(this.createdAt);
  return Math.ceil((today - created) / (1000 * 60 * 60 * 24));
});

// Index for efficient queries
maintenanceSchema.index({ property: 1, status: 1 });
maintenanceSchema.index({ tenant: 1, status: 1 });
maintenanceSchema.index({ priority: 1, status: 1 });

module.exports = mongoose.model('Maintenance', maintenanceSchema);

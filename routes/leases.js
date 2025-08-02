const express = require('express');
const Lease = require('../models/Lease');
const Property = require('../models/Property');
const User = require('../models/User');
const Payment = require('../models/Payment');
const { authenticateToken, managerAccess } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/leases
// @desc    Get all leases with filtering
// @access  Private (Admin, Property Manager)
router.get('/', authenticateToken, managerAccess, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      propertyId, 
      tenantId,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    let query = {};

    // Filters
    if (status) query.status = status;
    if (propertyId) query.property = propertyId;
    if (tenantId) query.tenant = tenantId;
    
    if (startDate || endDate) {
      query.startDate = {};
      if (startDate) query.startDate.$gte = new Date(startDate);
      if (endDate) query.startDate.$lte = new Date(endDate);
    }

    // Sorting
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const leases = await Lease.find(query)
      .populate('property', 'title address rentAmount')
      .populate('tenant', 'name email phone')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Lease.countDocuments(query);

    res.json({
      leases,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error('Get leases error:', error);
    res.status(500).json({ message: 'Server error fetching leases' });
  }
});

// @route   GET /api/leases/:id
// @desc    Get single lease
// @access  Private
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const lease = await Lease.findById(req.params.id)
      .populate('property', 'title address rentAmount images')
      .populate('tenant', 'name email phone');

    if (!lease) {
      return res.status(404).json({ message: 'Lease not found' });
    }

    // Role-based access control
    if (req.user.role === 'tenant' && lease.tenant._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get payment history for this lease
    const payments = await Payment.find({ lease: lease._id })
      .sort({ dueDate: -1 })
      .limit(12);

    res.json({
      lease,
      payments
    });

  } catch (error) {
    console.error('Get lease error:', error);
    res.status(500).json({ message: 'Server error fetching lease' });
  }
});

// @route   POST /api/leases
// @desc    Create new lease
// @access  Private (Admin, Property Manager)
router.post('/', authenticateToken, managerAccess, async (req, res) => {
  try {
    const {
      propertyId,
      tenantId,
      startDate,
      endDate,
      monthlyRent,
      securityDeposit,
      leaseTerms,
      paymentDueDate,
      lateFee,
      utilities,
      petDeposit,
      additionalCharges
    } = req.body;

    // Validate property
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(400).json({ message: 'Property not found' });
    }

    // Validate tenant
    const tenant = await User.findById(tenantId);
    if (!tenant || tenant.role !== 'tenant') {
      return res.status(400).json({ message: 'Invalid tenant' });
    }

    // Check for overlapping leases
    const overlappingLease = await Lease.findOne({
      property: propertyId,
      status: { $in: ['active', 'pending'] },
      $or: [
        {
          startDate: { $lte: new Date(endDate) },
          endDate: { $gte: new Date(startDate) }
        }
      ]
    });

    if (overlappingLease) {
      return res.status(400).json({ message: 'Property has overlapping lease dates' });
    }

    const leaseData = {
      property: propertyId,
      tenant: tenantId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      monthlyRent: monthlyRent || property.rentAmount,
      securityDeposit: securityDeposit || property.securityDeposit,
      leaseTerms,
      paymentDueDate: paymentDueDate || 1,
      lateFee: lateFee || { amount: 50, gracePeriod: 5 },
      utilities: utilities || {},
      petDeposit: petDeposit || 0,
      additionalCharges: additionalCharges || [],
      status: 'pending'
    };

    const lease = new Lease(leaseData);
    await lease.save();

    // Update property and tenant
    property.currentLease = lease._id;
    property.currentTenant = tenantId;
    property.status = 'occupied';
    await property.save();

    tenant.leaseId = lease._id;
    tenant.propertyId = propertyId;
    await tenant.save();

    // Create initial payment records
    await createPaymentSchedule(lease);

    const populatedLease = await Lease.findById(lease._id)
      .populate('property', 'title address')
      .populate('tenant', 'name email phone');

    res.status(201).json({
      message: 'Lease created successfully',
      lease: populatedLease
    });

  } catch (error) {
    console.error('Create lease error:', error);
    res.status(500).json({ message: 'Server error creating lease' });
  }
});

// @route   PUT /api/leases/:id
// @desc    Update lease
// @access  Private (Admin, Property Manager)
router.put('/:id', authenticateToken, managerAccess, async (req, res) => {
  try {
    const lease = await Lease.findById(req.params.id);
    
    if (!lease) {
      return res.status(404).json({ message: 'Lease not found' });
    }

    const updateData = { ...req.body };
    
    // Handle date updates
    if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
    if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);

    const updatedLease = await Lease.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('property', 'title address')
     .populate('tenant', 'name email phone');

    res.json({
      message: 'Lease updated successfully',
      lease: updatedLease
    });

  } catch (error) {
    console.error('Update lease error:', error);
    res.status(500).json({ message: 'Server error updating lease' });
  }
});

// @route   PUT /api/leases/:id/activate
// @desc    Activate lease
// @access  Private (Admin, Property Manager)
router.put('/:id/activate', authenticateToken, managerAccess, async (req, res) => {
  try {
    const lease = await Lease.findById(req.params.id);
    
    if (!lease) {
      return res.status(404).json({ message: 'Lease not found' });
    }

    lease.status = 'active';
    await lease.save();

    res.json({
      message: 'Lease activated successfully',
      lease
    });

  } catch (error) {
    console.error('Activate lease error:', error);
    res.status(500).json({ message: 'Server error activating lease' });
  }
});

// @route   PUT /api/leases/:id/terminate
// @desc    Terminate lease
// @access  Private (Admin, Property Manager)
router.put('/:id/terminate', authenticateToken, managerAccess, async (req, res) => {
  try {
    const lease = await Lease.findById(req.params.id);
    
    if (!lease) {
      return res.status(404).json({ message: 'Lease not found' });
    }

    lease.status = 'terminated';
    await lease.save();

    // Update property status
    await Property.findByIdAndUpdate(lease.property, {
      currentTenant: null,
      currentLease: null,
      status: 'available'
    });

    // Update tenant
    await User.findByIdAndUpdate(lease.tenant, {
      propertyId: null,
      leaseId: null
    });

    res.json({
      message: 'Lease terminated successfully',
      lease
    });

  } catch (error) {
    console.error('Terminate lease error:', error);
    res.status(500).json({ message: 'Server error terminating lease' });
  }
});

// @route   GET /api/leases/expiring
// @desc    Get leases expiring soon
// @access  Private (Admin, Property Manager)
router.get('/expiring/soon', authenticateToken, managerAccess, async (req, res) => {
  try {
    const { days = 60 } = req.query;
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + parseInt(days));

    const expiringLeases = await Lease.find({
      status: 'active',
      endDate: { $lte: futureDate, $gte: new Date() }
    })
    .populate('property', 'title address')
    .populate('tenant', 'name email phone')
    .sort({ endDate: 1 });

    res.json(expiringLeases);

  } catch (error) {
    console.error('Get expiring leases error:', error);
    res.status(500).json({ message: 'Server error fetching expiring leases' });
  }
});

// Helper function to create payment schedule
async function createPaymentSchedule(lease) {
  try {
    const payments = [];
    const startDate = new Date(lease.startDate);
    const endDate = new Date(lease.endDate);
    
    let currentDate = new Date(startDate);
    currentDate.setDate(lease.paymentDueDate);
    
    // If the due date has passed for the start month, move to next month
    if (currentDate < startDate) {
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    while (currentDate <= endDate) {
      const payment = new Payment({
        lease: lease._id,
        tenant: lease.tenant,
        property: lease.property,
        amount: lease.monthlyRent,
        paymentType: 'rent',
        paymentMethod: 'pending',
        dueDate: new Date(currentDate),
        status: 'pending',
        description: `Monthly rent for ${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        isRecurring: true,
        recurringPeriod: 'monthly'
      });

      payments.push(payment);
      
      // Move to next month
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    await Payment.insertMany(payments);
  } catch (error) {
    console.error('Error creating payment schedule:', error);
  }
}

// @route   DELETE /api/leases/:id
// @desc    Delete lease
// @access  Private (Admin, Property Manager)
router.delete('/:id', authenticateToken, managerAccess, async (req, res) => {
  try {
    const lease = await Lease.findById(req.params.id);
    if (!lease) {
      return res.status(404).json({ message: 'Lease not found' });
    }
    // Remove lease reference from property
    await Property.findByIdAndUpdate(lease.property, {
      $unset: { currentLease: '', currentTenant: '' },
      status: 'available',
    });
    // Remove lease and property reference from tenant
    await User.findByIdAndUpdate(lease.tenant, {
      $unset: { leaseId: '', propertyId: '' },
    });
    // Delete associated payments
    await Payment.deleteMany({ lease: lease._id });
    // Delete the lease itself
    await Lease.findByIdAndDelete(lease._id);
    res.json({ message: 'Lease deleted successfully' });
  } catch (error) {
    console.error('Delete lease error:', error);
    res.status(500).json({ message: 'Server error deleting lease' });
  }
});

module.exports = router;

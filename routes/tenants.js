const express = require('express');
const User = require('../models/User');
const Property = require('../models/Property');
const Lease = require('../models/Lease');
const { authenticateToken, managerAccess, adminOnly } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/tenants
// @desc    Get all tenants
// @access  Private (Admin, Property Manager)
router.get('/', authenticateToken, managerAccess, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, propertyId } = req.query;

    let query = { role: 'tenant', isActive: true };
    if (typeof status !== 'undefined') {
      query.isActive = status === 'active';
    }

    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by property
    if (propertyId) {
      query.propertyId = propertyId;
    }

    // Filter by active status
    if (status) {
      query.isActive = status === 'active';
    }

    let tenants = await User.find(query)
      .populate('propertyId', 'title address rentAmount')
      .populate('leaseId', 'startDate endDate status monthlyRent')
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // For each tenant, fetch their most recent lease if leaseId is null
    tenants = await Promise.all(tenants.map(async (tenant) => {
      if (!tenant.leaseId) {
        const activeLease = await Lease.findOne({ tenant: tenant._id })
          .sort({ startDate: -1 })
          .select('startDate endDate status monthlyRent');
        return {
          ...tenant.toObject(),
          activeLease: activeLease || null,
        };
      } else {
        return {
          ...tenant.toObject(),
          activeLease: tenant.leaseId,
        };
      }
    }));

    const total = await User.countDocuments(query);

    res.json({
      tenants,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error('Get tenants error:', error);
    res.status(500).json({ message: 'Server error fetching tenants' });
  }
});

// @route   GET /api/tenants/:id
// @desc    Get single tenant
// @access  Private
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const tenant = await User.findById(req.params.id)
      .populate('propertyId', 'title address rentAmount images')
      .populate('leaseId')
      .select('-password');

    if (!tenant || tenant.role !== 'tenant') {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Role-based access control
    if (req.user.role === 'tenant' && req.user._id.toString() !== tenant._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get tenant's lease history
    const leaseHistory = await Lease.find({ tenant: tenant._id })
      .populate('property', 'title address')
      .sort({ createdAt: -1 });

    res.json({
      tenant,
      leaseHistory
    });

  } catch (error) {
    console.error('Get tenant error:', error);
    res.status(500).json({ message: 'Server error fetching tenant' });
  }
});

// @route   POST /api/tenants
// @desc    Create new tenant
// @access  Private (Admin, Property Manager)
router.post('/', authenticateToken, managerAccess, async (req, res) => {
  try {
    const { email, password, name, phone, propertyId } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Validate property if provided
    let property = null;
    if (propertyId) {
      property = await Property.findById(propertyId);
      if (!property) {
        return res.status(400).json({ message: 'Invalid property ID' });
      }
    }

    const tenantData = {
      email: email.toLowerCase(),
      password,
      name,
      phone,
      role: 'tenant',
      propertyId: propertyId || null
    };

    const tenant = new User(tenantData);
    await tenant.save();

    // Update property if assigned
    if (property && property.status === 'available') {
      property.currentTenant = tenant._id;
      property.status = 'occupied';
      await property.save();
    }

    const populatedTenant = await User.findById(tenant._id)
      .populate('propertyId', 'title address rentAmount')
      .select('-password');

    res.status(201).json({
      message: 'Tenant created successfully',
      tenant: populatedTenant
    });

  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(500).json({ message: 'Server error creating tenant' });
  }
});

// @route   PUT /api/tenants/:id
// @desc    Update tenant
// @access  Private (Admin, Property Manager, or own profile)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const tenant = await User.findById(req.params.id);
    
    if (!tenant || tenant.role !== 'tenant') {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Role-based access control
    if (req.user.role === 'tenant' && req.user._id.toString() !== tenant._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { name, phone, propertyId } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;

    // Only managers can update property assignment
    if (propertyId && ['admin', 'property_manager'].includes(req.user.role)) {
      const property = await Property.findById(propertyId);
      if (!property) {
        return res.status(400).json({ message: 'Invalid property ID' });
      }

      // Update old property
      if (tenant.propertyId) {
        await Property.findByIdAndUpdate(tenant.propertyId, {
          currentTenant: null,
          status: 'available'
        });
      }

      // Update new property
      property.currentTenant = tenant._id;
      property.status = 'occupied';
      await property.save();

      updateData.propertyId = propertyId;
    }

    const updatedTenant = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('propertyId', 'title address rentAmount')
     .select('-password');

    res.json({
      message: 'Tenant updated successfully',
      tenant: updatedTenant
    });

  } catch (error) {
    console.error('Update tenant error:', error);
    res.status(500).json({ message: 'Server error updating tenant' });
  }
});

// @route   DELETE /api/tenants/:id
// @desc    Delete/Deactivate tenant
// @access  Private (Admin only)
router.delete('/:id', authenticateToken, managerAccess, async (req, res) => {
  try {
    const tenant = await User.findById(req.params.id);
    
    if (!tenant || tenant.role !== 'tenant') {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Deactivate instead of delete to preserve data integrity
    tenant.isActive = false;
    await tenant.save();

    // Update property status
    if (tenant.propertyId) {
      await Property.findByIdAndUpdate(tenant.propertyId, {
        currentTenant: null,
        status: 'available'
      });
    }

    // Update active leases
    await Lease.updateMany(
      { tenant: tenant._id, status: 'active' },
      { status: 'terminated' }
    );

    res.json({ message: 'Tenant deactivated successfully' });

  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(500).json({ message: 'Server error deleting tenant' });
  }
});

// @route   PUT /api/tenants/:id/activate
// @desc    Reactivate tenant
// @access  Private (Admin only)
router.put('/:id/activate', authenticateToken, adminOnly, async (req, res) => {
  try {
    const tenant = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: true },
      { new: true }
    ).select('-password');

    if (!tenant || tenant.role !== 'tenant') {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    res.json({
      message: 'Tenant activated successfully',
      tenant
    });

  } catch (error) {
    console.error('Activate tenant error:', error);
    res.status(500).json({ message: 'Server error activating tenant' });
  }
});

module.exports = router;

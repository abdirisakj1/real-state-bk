const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Maintenance = require('../models/Maintenance');
const Property = require('../models/Property');
const { authenticateToken, managerAccess } = require('../middleware/auth');

const router = express.Router();

// Configure multer for maintenance image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/maintenance');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'maintenance-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// @route   GET /api/maintenance
// @desc    Get all maintenance requests with filtering
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      priority,
      category,
      propertyId,
      tenantId
    } = req.query;

    let query = {};

    // Role-based filtering
    if (req.user.role === 'tenant') {
      query.tenant = req.user._id;
    } else if (req.user.role === 'property_manager') {
      // Property managers can see requests for properties they manage
      const managedProperties = await Property.find({ managedBy: req.user._id }).select('_id');
      query.property = { $in: managedProperties.map(p => p._id) };
    }

    // Filters
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (category) query.category = category;
    if (propertyId) query.property = propertyId;
    if (tenantId) query.tenant = tenantId;

    const maintenanceRequests = await Maintenance.find(query)
      .populate('property', 'title address')
      .populate('tenant', 'name email phone')
      .populate('requestedBy', 'name email')
      .populate('assignedTo', 'name email')
      .populate('notes.author', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Maintenance.countDocuments(query);

    res.json({
      maintenanceRequests,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error('Get maintenance requests error:', error);
    res.status(500).json({ message: 'Server error fetching maintenance requests' });
  }
});

// @route   GET /api/maintenance/:id
// @desc    Get single maintenance request
// @access  Private
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const maintenance = await Maintenance.findById(req.params.id)
      .populate('property', 'title address')
      .populate('tenant', 'name email phone')
      .populate('requestedBy', 'name email')
      .populate('assignedTo', 'name email phone')
      .populate('notes.author', 'name');

    if (!maintenance) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }

    // Role-based access control
    if (req.user.role === 'tenant' && 
        maintenance.tenant && 
        maintenance.tenant._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(maintenance);

  } catch (error) {
    console.error('Get maintenance request error:', error);
    res.status(500).json({ message: 'Server error fetching maintenance request' });
  }
});

// @route   POST /api/maintenance
// @desc    Create new maintenance request
// @access  Private
router.post('/', authenticateToken, upload.array('images', 5), async (req, res) => {
  try {
    const {
      propertyId,
      title,
      description,
      category,
      priority = 'medium',
      isUrgent = false
    } = req.body;

    // Validate property
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(400).json({ message: 'Property not found' });
    }

    // Role-based validation
    if (req.user.role === 'tenant' && 
        property.currentTenant && 
        property.currentTenant.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only create requests for your assigned property' });
    }

    const maintenanceData = {
      property: propertyId,
      tenant: req.user.role === 'tenant' ? req.user._id : null,
      requestedBy: req.user._id,
      title,
      description,
      category,
      priority,
      isUrgent: isUrgent === 'true' || isUrgent === true,
      status: 'pending'
    };

    // Handle uploaded images
    if (req.files && req.files.length > 0) {
      maintenanceData.images = req.files.map(file => ({
        url: `/uploads/maintenance/${file.filename}`,
        caption: file.originalname
      }));
    }

    const maintenance = new Maintenance(maintenanceData);
    await maintenance.save();

    const populatedMaintenance = await Maintenance.findById(maintenance._id)
      .populate('property', 'title address')
      .populate('requestedBy', 'name email');

    res.status(201).json({
      message: 'Maintenance request created successfully',
      maintenance: populatedMaintenance
    });

  } catch (error) {
    console.error('Create maintenance request error:', error);
    res.status(500).json({ message: 'Server error creating maintenance request' });
  }
});

// @route   PUT /api/maintenance/:id
// @desc    Update maintenance request
// @access  Private (Admin, Property Manager, or requester)
router.put('/:id', authenticateToken, upload.array('images', 5), async (req, res) => {
  try {
    const maintenance = await Maintenance.findById(req.params.id);
    
    if (!maintenance) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }

    // Role-based access control
    if (req.user.role === 'tenant' && 
        maintenance.requestedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = { ...req.body };

    // Handle date fields
    if (updateData.scheduledDate) {
      updateData.scheduledDate = new Date(updateData.scheduledDate);
    }
    if (updateData.completedDate) {
      updateData.completedDate = new Date(updateData.completedDate);
    }

    // Handle vendor info
    if (req.body.vendorInfo) {
      updateData.vendorInfo = JSON.parse(req.body.vendorInfo);
    }

    // Handle tenant access
    if (req.body.tenantAccess) {
      updateData.tenantAccess = JSON.parse(req.body.tenantAccess);
    }

    // Handle new uploaded images
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map(file => ({
        url: `/uploads/maintenance/${file.filename}`,
        caption: file.originalname
      }));
      
      updateData.images = [...(maintenance.images || []), ...newImages];
    }

    const updatedMaintenance = await Maintenance.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('property', 'title address')
     .populate('assignedTo', 'name email phone');

    res.json({
      message: 'Maintenance request updated successfully',
      maintenance: updatedMaintenance
    });

  } catch (error) {
    console.error('Update maintenance request error:', error);
    res.status(500).json({ message: 'Server error updating maintenance request' });
  }
});

// @route   POST /api/maintenance/:id/notes
// @desc    Add note to maintenance request
// @access  Private
router.post('/:id/notes', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content || content.trim() === '') {
      return res.status(400).json({ message: 'Note content is required' });
    }

    const maintenance = await Maintenance.findById(req.params.id);
    
    if (!maintenance) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }

    const newNote = {
      author: req.user._id,
      content: content.trim(),
      timestamp: new Date()
    };

    maintenance.notes.push(newNote);
    await maintenance.save();

    const populatedMaintenance = await Maintenance.findById(maintenance._id)
      .populate('notes.author', 'name');

    res.json({
      message: 'Note added successfully',
      maintenance: populatedMaintenance
    });

  } catch (error) {
    console.error('Add maintenance note error:', error);
    res.status(500).json({ message: 'Server error adding note' });
  }
});

// @route   PUT /api/maintenance/:id/assign
// @desc    Assign maintenance request to user
// @access  Private (Admin, Property Manager)
router.put('/:id/assign', authenticateToken, managerAccess, async (req, res) => {
  try {
    const { assignedTo } = req.body;
    
    const maintenance = await Maintenance.findByIdAndUpdate(
      req.params.id,
      { assignedTo: assignedTo || null },
      { new: true }
    ).populate('assignedTo', 'name email phone');

    if (!maintenance) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }

    res.json({
      message: assignedTo ? 'Maintenance request assigned successfully' : 'Assignment removed successfully',
      maintenance
    });

  } catch (error) {
    console.error('Assign maintenance request error:', error);
    res.status(500).json({ message: 'Server error assigning maintenance request' });
  }
});

// @route   PUT /api/maintenance/:id/status
// @desc    Update maintenance request status
// @access  Private (Admin, Property Manager, or assigned user)
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    
    const maintenance = await Maintenance.findById(req.params.id);
    
    if (!maintenance) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }

    // Role-based access control
    const canUpdateStatus = req.user.role === 'admin' || 
                           req.user.role === 'property_manager' ||
                           (maintenance.assignedTo && maintenance.assignedTo.toString() === req.user._id.toString());
    
    if (!canUpdateStatus) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = { status };
    
    // Set completion date if marking as completed
    if (status === 'completed' && maintenance.status !== 'completed') {
      updateData.completedDate = new Date();
    }

    const updatedMaintenance = await Maintenance.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('property', 'title address')
     .populate('assignedTo', 'name email');

    res.json({
      message: 'Status updated successfully',
      maintenance: updatedMaintenance
    });

  } catch (error) {
    console.error('Update maintenance status error:', error);
    res.status(500).json({ message: 'Server error updating status' });
  }
});

module.exports = router;

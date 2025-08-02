const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Property = require('../models/Property');
const { authenticateToken, managerAccess, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/properties');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'property-' + uniqueSuffix + path.extname(file.originalname));
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

// @route   GET /api/properties
// @desc    Get all properties with filtering and search
// @access  Private (Admin, Property Manager)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      propertyType,
      minRent,
      maxRent,
      bedrooms,
      city,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    let query = {};
    
    // Role-based filtering
    if (req.user.role === 'property_manager') {
      query.managedBy = req.user._id;
    }

    // Search functionality
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'address.street': { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } }
      ];
    }

    // Filters
    if (status) query.status = status;
    if (propertyType) query.propertyType = propertyType;
    if (city) query['address.city'] = { $regex: city, $options: 'i' };
    if (bedrooms) query.bedrooms = parseInt(bedrooms);
    
    if (minRent || maxRent) {
      query.rentAmount = {};
      if (minRent) query.rentAmount.$gte = parseFloat(minRent);
      if (maxRent) query.rentAmount.$lte = parseFloat(maxRent);
    }

    // Sorting
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with pagination
    const properties = await Property.find(query)
      .populate('managedBy', 'name email')
      .populate('currentTenant', 'name email phone')
      .populate('currentLease', 'startDate endDate status')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Property.countDocuments(query);

    res.json({
      properties,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
      hasNextPage: page < Math.ceil(total / limit),
      hasPrevPage: page > 1
    });

  } catch (error) {
    console.error('Get properties error:', error);
    res.status(500).json({ message: 'Server error fetching properties' });
  }
});

// @route   GET /api/properties/:id
// @desc    Get single property
// @access  Private
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id)
      .populate('managedBy', 'name email phone')
      .populate('currentTenant', 'name email phone')
      .populate('currentLease');

    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Role-based access control
    if (req.user.role === 'property_manager' && property.managedBy._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (req.user.role === 'tenant' && property.currentTenant?._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(property);

  } catch (error) {
    console.error('Get property error:', error);
    res.status(500).json({ message: 'Server error fetching property' });
  }
});

// @route   POST /api/properties
// @desc    Create new property
// @access  Private (Admin, Property Manager)
router.post('/', authenticateToken, managerAccess, upload.array('images', 10), async (req, res) => {
  try {
    const propertyData = {
      ...req.body,
      managedBy: req.user._id
    };

    // Parse JSON fields
    if (req.body.address) {
      propertyData.address = JSON.parse(req.body.address);
    }
    if (req.body.amenities) {
      propertyData.amenities = JSON.parse(req.body.amenities);
    }
    if (req.body.utilities) {
      propertyData.utilities = JSON.parse(req.body.utilities);
    }
    if (req.body.petPolicy) {
      propertyData.petPolicy = JSON.parse(req.body.petPolicy);
    }

    // Handle uploaded images
    if (req.files && req.files.length > 0) {
      propertyData.images = req.files.map((file, index) => ({
        url: `/uploads/properties/${file.filename}`,
        caption: req.body[`imageCaption${index}`] || '',
        isPrimary: index === 0
      }));
    }

    const property = new Property(propertyData);
    await property.save();

    const populatedProperty = await Property.findById(property._id)
      .populate('managedBy', 'name email');

    res.status(201).json({
      message: 'Property created successfully',
      property: populatedProperty
    });

  } catch (error) {
    console.error('Create property error:', error);
    res.status(500).json({ message: 'Server error creating property', error: error.message });
  }
});

// @route   PUT /api/properties/:id
// @desc    Update property
// @access  Private (Admin, Property Manager)
router.put('/:id', authenticateToken, managerAccess, upload.array('images', 10), async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Role-based access control
    if (req.user.role === 'property_manager' && property.managedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = { ...req.body };

    // Parse JSON fields
    if (req.body.address) {
      updateData.address = JSON.parse(req.body.address);
    }
    if (req.body.amenities) {
      updateData.amenities = JSON.parse(req.body.amenities);
    }
    if (req.body.utilities) {
      updateData.utilities = JSON.parse(req.body.utilities);
    }
    if (req.body.petPolicy) {
      updateData.petPolicy = JSON.parse(req.body.petPolicy);
    }

    // Handle new uploaded images
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map((file, index) => ({
        url: `/uploads/properties/${file.filename}`,
        caption: req.body[`imageCaption${index}`] || '',
        isPrimary: property.images.length === 0 && index === 0
      }));
      
      updateData.images = [...(property.images || []), ...newImages];
    }

    const updatedProperty = await Property.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('managedBy', 'name email')
     .populate('currentTenant', 'name email phone');

    res.json({
      message: 'Property updated successfully',
      property: updatedProperty
    });

  } catch (error) {
    console.error('Update property error:', error);
    res.status(500).json({ message: 'Server error updating property' });
  }
});

// @route   DELETE /api/properties/:id
// @desc    Delete property
// @access  Private (Admin only)
router.delete('/:id', authenticateToken, adminOnly, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Delete associated images
    if (property.images && property.images.length > 0) {
      property.images.forEach(image => {
        const imagePath = path.join(__dirname, '../', image.url);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      });
    }

    await Property.findByIdAndDelete(req.params.id);

    res.json({ message: 'Property deleted successfully' });

  } catch (error) {
    console.error('Delete property error:', error);
    res.status(500).json({ message: 'Server error deleting property' });
  }
});

// @route   DELETE /api/properties/:id/images/:imageIndex
// @desc    Delete specific property image
// @access  Private (Admin, Property Manager)
router.delete('/:id/images/:imageIndex', authenticateToken, managerAccess, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Role-based access control
    if (req.user.role === 'property_manager' && property.managedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const imageIndex = parseInt(req.params.imageIndex);
    
    if (imageIndex < 0 || imageIndex >= property.images.length) {
      return res.status(400).json({ message: 'Invalid image index' });
    }

    // Delete image file
    const imageToDelete = property.images[imageIndex];
    const imagePath = path.join(__dirname, '../', imageToDelete.url);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    // Remove image from array
    property.images.splice(imageIndex, 1);
    await property.save();

    res.json({ message: 'Image deleted successfully' });

  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ message: 'Server error deleting image' });
  }
});

module.exports = router;

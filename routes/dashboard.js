const express = require('express');
const Property = require('../models/Property');
const User = require('../models/User');
const Lease = require('../models/Lease');
const Payment = require('../models/Payment');
const Maintenance = require('../models/Maintenance');
const { authenticateToken, managerAccess } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/dashboard/stats
// @desc    Get dashboard statistics
// @access  Private (Admin, Property Manager)
router.get('/stats', authenticateToken, managerAccess, async (req, res) => {
  try {
    // Basic counts
    const totalProperties = await Property.countDocuments({ isActive: true });
    const occupiedProperties = await Property.countDocuments({ status: 'occupied' });
    const availableProperties = await Property.countDocuments({ status: 'available' });
    const maintenanceProperties = await Property.countDocuments({ status: 'maintenance' });
    
    const totalTenants = await User.countDocuments({ role: 'tenant', isActive: true });
    const activeLeases = await Lease.countDocuments({ status: 'active' });
    
    // Payment statistics
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);
    
    const nextMonth = new Date(currentMonth);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    
    const monthlyRevenue = await Payment.aggregate([
      {
        $match: {
          status: 'completed',
          paidDate: { $gte: currentMonth, $lt: nextMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);
    
    const pendingPayments = await Payment.countDocuments({
      status: 'pending',
      dueDate: { $gte: currentMonth, $lt: nextMonth }
    });
    
    const overduePayments = await Payment.countDocuments({
      status: 'pending',
      dueDate: { $lt: new Date() }
    });
    
    // Maintenance requests
    const pendingMaintenance = await Maintenance.countDocuments({ status: { $in: ['pending', 'in_progress'] } });
    const urgentMaintenance = await Maintenance.countDocuments({ 
      status: { $in: ['pending', 'in_progress'] },
      priority: { $in: ['high', 'emergency'] }
    });
    
    // Recent activities
    const recentPayments = await Payment.find({ status: 'completed' })
      .populate('tenant', 'name')
      .populate('property', 'title')
      .sort({ paidDate: -1 })
      .limit(5);
      
    const recentMaintenance = await Maintenance.find()
      .populate('property', 'title')
      .populate('requestedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      properties: {
        total: totalProperties,
        occupied: occupiedProperties,
        available: availableProperties,
        maintenance: maintenanceProperties,
        occupancyRate: totalProperties > 0 ? ((occupiedProperties / totalProperties) * 100).toFixed(1) : 0
      },
      tenants: {
        total: totalTenants,
        activeLeases
      },
      payments: {
        monthlyRevenue: monthlyRevenue[0]?.total || 0,
        pending: pendingPayments,
        overdue: overduePayments
      },
      maintenance: {
        pending: pendingMaintenance,
        urgent: urgentMaintenance
      },
      recentActivity: {
        payments: recentPayments,
        maintenance: recentMaintenance
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ message: 'Server error fetching dashboard statistics' });
  }
});

// @route   GET /api/dashboard/revenue-chart
// @desc    Get revenue chart data for the last 12 months
// @access  Private (Admin, Property Manager)
router.get('/revenue-chart', authenticateToken, managerAccess, async (req, res) => {
  try {
    const monthsData = [];
    
    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      
      const nextMonth = new Date(date);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      
      const revenue = await Payment.aggregate([
        {
          $match: {
            status: 'completed',
            paidDate: { $gte: date, $lt: nextMonth }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ]);
      
      monthsData.push({
        month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        revenue: revenue[0]?.total || 0
      });
    }
    
    res.json(monthsData);

  } catch (error) {
    console.error('Get revenue chart error:', error);
    res.status(500).json({ message: 'Server error fetching revenue chart data' });
  }
});

// @route   GET /api/dashboard/property-status
// @desc    Get property status distribution
// @access  Private (Admin, Property Manager)
router.get('/property-status', authenticateToken, managerAccess, async (req, res) => {
  try {
    const statusData = await Property.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    res.json(statusData);

  } catch (error) {
    console.error('Get property status error:', error);
    res.status(500).json({ message: 'Server error fetching property status data' });
  }
});

// @route   GET /api/dashboard/upcoming-events
// @desc    Get upcoming events (lease expirations, due payments, etc.)
// @access  Private (Admin, Property Manager)
router.get('/upcoming-events', authenticateToken, managerAccess, async (req, res) => {
  try {
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30); // Next 30 days
    
    // Upcoming lease expirations
    const expiringLeases = await Lease.find({
      status: 'active',
      endDate: { $gte: today, $lte: futureDate }
    })
    .populate('property', 'title')
    .populate('tenant', 'name email')
    .sort({ endDate: 1 });
    
    // Upcoming payments
    const upcomingPayments = await Payment.find({
      status: 'pending',
      dueDate: { $gte: today, $lte: futureDate }
    })
    .populate('property', 'title')
    .populate('tenant', 'name')
    .sort({ dueDate: 1 })
    .limit(10);
    
    // Scheduled maintenance
    const scheduledMaintenance = await Maintenance.find({
      status: { $in: ['pending', 'in_progress'] },
      scheduledDate: { $gte: today, $lte: futureDate }
    })
    .populate('property', 'title')
    .sort({ scheduledDate: 1 });

    res.json({
      expiringLeases,
      upcomingPayments,
      scheduledMaintenance
    });

  } catch (error) {
    console.error('Get upcoming events error:', error);
    res.status(500).json({ message: 'Server error fetching upcoming events' });
  }
});

// @route   GET /api/dashboard/tenant/:tenantId
// @desc    Get tenant-specific dashboard data
// @access  Private (Tenant only for own data)
router.get('/tenant/:tenantId', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    
    // Role-based access control
    if (req.user.role === 'tenant' && req.user._id.toString() !== tenantId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Get tenant's current lease
    const currentLease = await Lease.findOne({ 
      tenant: tenantId, 
      status: 'active' 
    }).populate('property', 'title address images rentAmount');
    
    // Get payment history
    const payments = await Payment.find({ tenant: tenantId })
      .sort({ dueDate: -1 })
      .limit(12);
    
    // Get upcoming payments
    const upcomingPayments = await Payment.find({
      tenant: tenantId,
      status: 'pending',
      dueDate: { $gte: new Date() }
    }).sort({ dueDate: 1 }).limit(3);
    
    // Get overdue payments
    const overduePayments = await Payment.find({
      tenant: tenantId,
      status: 'pending',
      dueDate: { $lt: new Date() }
    }).sort({ dueDate: 1 });
    
    // Get maintenance requests
    const maintenanceRequests = await Maintenance.find({ tenant: tenantId })
      .populate('property', 'title')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      currentLease,
      payments,
      upcomingPayments,
      overduePayments,
      maintenanceRequests,
      summary: {
        totalPaid: payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0),
        pendingAmount: upcomingPayments.reduce((sum, p) => sum + p.amount, 0),
        overdueAmount: overduePayments.reduce((sum, p) => sum + p.amount, 0)
      }
    });

  } catch (error) {
    console.error('Get tenant dashboard error:', error);
    res.status(500).json({ message: 'Server error fetching tenant dashboard' });
  }
});

module.exports = router;

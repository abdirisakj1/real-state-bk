const express = require('express');
const Payment = require('../models/Payment');
const Lease = require('../models/Lease');
const { authenticateToken, managerAccess } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/payments
// @desc    Get all payments with filtering
// @access  Private (Admin, Property Manager)
router.get('/', authenticateToken, managerAccess, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      paymentType,
      tenantId,
      propertyId,
      startDate,
      endDate,
      overdue
    } = req.query;

    let query = {};

    // Filters
    if (status) query.status = status;
    if (paymentType) query.paymentType = paymentType;
    if (tenantId) query.tenant = tenantId;
    if (propertyId) query.property = propertyId;
    
    if (startDate || endDate) {
      query.dueDate = {};
      if (startDate) query.dueDate.$gte = new Date(startDate);
      if (endDate) query.dueDate.$lte = new Date(endDate);
    }

    // Filter overdue payments
    if (overdue === 'true') {
      query.status = 'pending';
      query.dueDate = { $lt: new Date() };
    }

    const payments = await Payment.find(query)
      .populate('tenant', 'name email phone')
      .populate('property', 'title address')
      .populate('lease', 'startDate endDate')
      .sort({ dueDate: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Payment.countDocuments(query);

    res.json({
      payments,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ message: 'Server error fetching payments' });
  }
});

// @route   PUT /api/payments/:id
// @desc    Update payment record
// @access  Private (Admin, Property Manager)
router.put('/:id', authenticateToken, managerAccess, async (req, res) => {
  try {
    const { leaseId, amount, dueDate, paymentType, paymentMethod } = req.body;
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    // If leaseId is being changed, validate it
    if (leaseId && leaseId !== String(payment.lease)) {
      const lease = await Lease.findById(leaseId);
      if (!lease) return res.status(400).json({ message: 'Lease not found' });
      payment.lease = leaseId;
      payment.tenant = lease.tenant;
      payment.property = lease.property;
    }
    if (amount !== undefined) payment.amount = amount;
    if (dueDate !== undefined) payment.dueDate = new Date(dueDate);
    if (paymentType !== undefined) payment.paymentType = paymentType;
    if (paymentMethod !== undefined) payment.paymentMethod = paymentMethod;
    await payment.save();
    const populatedPayment = await Payment.findById(payment._id)
      .populate('tenant', 'name email')
      .populate('property', 'title address');
    res.json({ message: 'Payment updated successfully', payment: populatedPayment });
  } catch (error) {
    console.error('Update payment error:', error);
    res.status(500).json({ message: 'Server error updating payment' });
  }
});

// @route   GET /api/payments/:id
// @desc    Get single payment
// @access  Private
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('tenant', 'name email phone')
      .populate('property', 'title address')
      .populate('lease', 'startDate endDate monthlyRent');

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // Role-based access control
    if (req.user.role === 'tenant' && payment.tenant._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(payment);

  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({ message: 'Server error fetching payment' });
  }
});

// @route   POST /api/payments
// @desc    Create new payment record
// @access  Private (Admin, Property Manager)
router.post('/', authenticateToken, managerAccess, async (req, res) => {
  try {
    const {
      leaseId,
      propertyId,
      tenantId,
      amount,
      paymentType,
      paymentMethod,
      dueDate,
      description,
      paidDate,
      status = 'pending'
    } = req.body;

    let paymentData = {
      amount,
      paymentType,
      paymentMethod,
      dueDate: new Date(dueDate),
      description,
      status
    };

    if (leaseId) {
      // If leaseId provided, use legacy logic
      const lease = await Lease.findById(leaseId);
      if (!lease) {
        return res.status(400).json({ message: 'Lease not found' });
      }
      paymentData.lease = leaseId;
      paymentData.tenant = lease.tenant;
      paymentData.property = lease.property;
    } else {
      // New logic: allow propertyId and tenantId directly
      if (!propertyId || !tenantId) {
        return res.status(400).json({ message: 'propertyId and tenantId required' });
      }
      paymentData.property = propertyId;
      paymentData.tenant = tenantId;
    }

    if (paidDate) {
      paymentData.paidDate = new Date(paidDate);
    }

    const payment = new Payment(paymentData);
    await payment.save();

    const populatedPayment = await Payment.findById(payment._id)
      .populate('tenant', 'name email')
      .populate('property', 'title address');

    res.status(201).json({
      message: 'Payment record created successfully',
      payment: populatedPayment
    });

  } catch (error) {
    console.error('Create payment error:', error);
    res.status(500).json({ message: 'Server error creating payment' });
  }
});

// @route   PUT /api/payments/:id/pay
// @desc    Mark payment as paid
// @access  Private (Admin, Property Manager)
router.put('/:id/pay', authenticateToken, managerAccess, async (req, res) => {
  try {
    const { paymentMethod, transactionId, notes, paidAmount } = req.body;
    
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // Calculate late fee if payment is overdue
    let lateFee = 0;
    if (new Date() > new Date(payment.dueDate)) {
      const lease = await Lease.findById(payment.lease);
      if (lease && lease.lateFee) {
        const daysLate = Math.ceil((new Date() - new Date(payment.dueDate)) / (1000 * 60 * 60 * 24));
        if (daysLate > lease.lateFee.gracePeriod) {
          lateFee = lease.lateFee.amount;
        }
      }
    }

    payment.status = 'completed';
    payment.paidDate = new Date();
    payment.paymentMethod = paymentMethod;
    payment.transactionId = transactionId;
    payment.notes = notes || '';
    payment.lateFee = lateFee;
    payment.amount = paidAmount || payment.amount;

    await payment.save();

    // Create late fee payment if applicable
    if (lateFee > 0) {
      const lateFeePayment = new Payment({
        lease: payment.lease,
        tenant: payment.tenant,
        property: payment.property,
        amount: lateFee,
        paymentType: 'late_fee',
        paymentMethod: paymentMethod,
        dueDate: new Date(),
        paidDate: new Date(),
        status: 'completed',
        description: `Late fee for payment ${payment._id}`,
        transactionId: transactionId + '_LATE'
      });
      await lateFeePayment.save();
    }

    const populatedPayment = await Payment.findById(payment._id)
      .populate('tenant', 'name email')
      .populate('property', 'title address');

    res.json({
      message: 'Payment marked as paid successfully',
      payment: populatedPayment,
      lateFeeApplied: lateFee
    });

  } catch (error) {
    console.error('Mark payment as paid error:', error);
    res.status(500).json({ message: 'Server error processing payment' });
  }
});

// @route   GET /api/payments/overdue
// @desc    Get overdue payments
// @access  Private (Admin, Property Manager)
router.get('/overdue/list', authenticateToken, managerAccess, async (req, res) => {
  try {
    const overduePayments = await Payment.find({
      status: 'pending',
      dueDate: { $lt: new Date() }
    })
    .populate('tenant', 'name email phone')
    .populate('property', 'title address')
    .sort({ dueDate: 1 });

    res.json(overduePayments);

  } catch (error) {
    console.error('Get overdue payments error:', error);
    res.status(500).json({ message: 'Server error fetching overdue payments' });
  }
});

// @route   GET /api/payments/tenant/:tenantId
// @desc    Get payments for specific tenant
// @access  Private
router.get('/tenant/:tenantId', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;

    // Role-based access control
    if (req.user.role === 'tenant' && req.user._id.toString() !== tenantId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const payments = await Payment.find({ tenant: tenantId })
      .populate('property', 'title address')
      .populate('lease', 'startDate endDate')
      .sort({ dueDate: -1 });

    res.json(payments);

  } catch (error) {
    console.error('Get tenant payments error:', error);
    res.status(500).json({ message: 'Server error fetching tenant payments' });
  }
});

// @route   GET /api/payments/stats
// @desc    Get payment statistics
// @access  Private (Admin, Property Manager)
router.get('/stats/summary', authenticateToken, managerAccess, async (req, res) => {
  try {
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const nextMonth = new Date(currentMonth);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    // Current month stats
    const monthlyStats = await Payment.aggregate([
      {
        $match: {
          dueDate: { $gte: currentMonth, $lt: nextMonth }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    // Overdue payments
    const overdueCount = await Payment.countDocuments({
      status: 'pending',
      dueDate: { $lt: new Date() }
    });

    const overdueAmount = await Payment.aggregate([
      {
        $match: {
          status: 'pending',
          dueDate: { $lt: new Date() }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    // Total collected this year
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const yearlyCollected = await Payment.aggregate([
      {
        $match: {
          status: 'completed',
          paidDate: { $gte: yearStart }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    res.json({
      monthlyStats,
      overdue: {
        count: overdueCount,
        amount: overdueAmount[0]?.total || 0
      },
      yearlyCollected: yearlyCollected[0]?.total || 0
    });

  } catch (error) {
    console.error('Get payment stats error:', error);
    res.status(500).json({ message: 'Server error fetching payment statistics' });
  }
});

// @route   DELETE /api/payments/:id
// @desc    Delete payment by ID
// @access  Private (Admin, Property Manager)
router.delete('/:id', authenticateToken, managerAccess, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    res.json({ message: 'Payment deleted successfully' });
  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(500).json({ message: 'Server error deleting payment' });
  }
});

module.exports = router;

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/rental-management', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✓ MongoDB connected successfully'))
.catch((err) => console.error('❌ MongoDB connection error:', err));

// Load routes with proper error handling
const routesPath = path.join(__dirname, 'routes');

// Ensure routes directory exists
if (!fs.existsSync(routesPath)) {
  console.log('⚠ Routes directory not found, creating...');
  fs.mkdirSync(routesPath, { recursive: true });
}

// Register clients route
const clientsRoutePath = path.join(routesPath, 'clients.js');
if (fs.existsSync(clientsRoutePath)) {
  try {
    app.use('/api/clients', require('./routes/clients'));
    console.log('✓ Clients routes loaded');
  } catch (error) {
    console.log('⚠ Error loading clients routes:', error.message);
  }
}

// Load auth routes if they exist
const authRoutePath = path.join(routesPath, 'auth.js');
if (fs.existsSync(authRoutePath)) {
  try {
    app.use('/api/auth', require('./routes/auth'));
    console.log('✓ Auth routes loaded');
  } catch (error) {
    console.log('⚠ Error loading auth routes:', error.message);
  }
} else {
  console.log('⚠ Auth routes not found, using built-in auth');
  // Include basic auth functionality inline
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  
  // Simple User Schema
  const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ['admin', 'property_manager', 'tenant'], required: true },
    phone: String,
    isActive: { type: Boolean, default: true },
    lastLogin: Date
  }, { timestamps: true });
  
  userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  });
  
  userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };
  
  userSchema.methods.toJSON = function() {
    const userObject = this.toObject();
    delete userObject.password;
    return userObject;
  };
  
  const User = mongoose.model('User', userSchema);
  
  // Initialize test users
  const initializeUsers = async () => {
    try {
      const testUsers = [
        { email: 'admin@rental.com', password: 'admin123', name: 'System Administrator', role: 'admin', phone: '+1-555-0001' },
        { email: 'manager@rental.com', password: 'manager123', name: 'Property Manager', role: 'property_manager', phone: '+1-555-0002' },
        { email: 'tenant1@rental.com', password: 'tenant123', name: 'John Doe', role: 'tenant', phone: '+1-555-0003' },
        { email: 'tenant2@rental.com', password: 'tenant123', name: 'Jane Smith', role: 'tenant', phone: '+1-555-0004' }
      ];
  
      for (const userData of testUsers) {
        const existingUser = await User.findOne({ email: userData.email });
        if (!existingUser) {
          const user = new User(userData);
          await user.save();
          console.log(`✓ Created user: ${userData.email} (${userData.role})`);
        }
      }
    } catch (error) {
      console.error('❌ Error initializing users:', error);
    }
  };
  
  // Auth middleware
  const authenticateToken = async (req, res, next) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
  
      if (!token) {
        return res.status(401).json({ message: 'Access token required' });
      }
  
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      const user = await User.findById(decoded.userId).select('-password');
      
      if (!user || !user.isActive) {
        return res.status(401).json({ message: 'Invalid token or user not active' });
      }
  
      req.user = user;
      next();
    } catch (error) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
  };
  
  // Auth routes
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
  
      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
      }
  
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
  
      if (!user.isActive) {
        return res.status(401).json({ message: 'Account is deactivated' });
      }
  
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
  
      user.lastLogin = new Date();
      await user.save();
  
      const token = jwt.sign(
        { userId: user._id, email: user.email, role: user.role },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );
  
      res.json({
        message: 'Login successful',
        token,
        user: { id: user._id, email: user.email, name: user.name, role: user.role, phone: user.phone, lastLogin: user.lastLogin }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: 'Server error during login' });
    }
  });
  
  app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
      res.json({ user: req.user });
    } catch (error) {
      res.status(500).json({ message: 'Server error' });
    }
  });
  
  app.get('/api/auth/test-users', (req, res) => {
    const testCredentials = [
      { email: 'admin@rental.com', password: 'admin123', role: 'admin', name: 'System Administrator' },
      { email: 'manager@rental.com', password: 'manager123', role: 'property_manager', name: 'Property Manager' },
      { email: 'tenant1@rental.com', password: 'tenant123', role: 'tenant', name: 'John Doe' },
      { email: 'tenant2@rental.com', password: 'tenant123', role: 'tenant', name: 'Jane Smith' }
    ];
    res.json({ message: 'Test user credentials', users: testCredentials });
  });
  
  // Dashboard routes
  app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
    res.json({
      properties: { total: 5, occupied: 3, available: 2, maintenance: 0, occupancyRate: 60 },
      tenants: { total: 3, activeLeases: 3 },
      payments: { monthlyRevenue: 4500, pending: 2, overdue: 1 },
      maintenance: { pending: 1, urgent: 0 },
      recentActivity: { payments: [], maintenance: [] }
    });
  });
  
  app.get('/api/dashboard/tenant/:tenantId', authenticateToken, (req, res) => {
    res.json({
      currentLease: {
        property: { title: 'Sample Property', address: { street: '123 Main St' }, rentAmount: 1500 },
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31')
      },
      payments: [{ description: 'Monthly rent for January 2024', amount: 1500, dueDate: new Date('2024-01-01'), status: 'completed' }],
      upcomingPayments: [],
      overduePayments: [],
      maintenanceRequests: [],
      summary: { totalPaid: 1500, pendingAmount: 0, overdueAmount: 0 }
    });
  });
  
  app.get('/api/properties', authenticateToken, (req, res) => {
    res.json({
      properties: [{
        _id: '1',
        title: 'Modern Apartment',
        address: { street: '123 Main St', city: 'New York', state: 'NY' },
        rentAmount: 1500,
        bedrooms: 2,
        bathrooms: 1,
        status: 'occupied',
        images: [],
        currentTenant: { name: 'John Doe' }
      }],
      totalPages: 1,
      currentPage: 1,
      total: 1
    });
  });
  
  // Initialize users when server starts
  setTimeout(initializeUsers, 1000);
}

// Load other routes
const routeFiles = ['properties', 'tenants', 'leases', 'payments', 'dashboard', 'maintenance'];
routeFiles.forEach(routeFile => {
  const routePath = path.join(routesPath, `${routeFile}.js`);
  if (fs.existsSync(routePath)) {
    try {
      app.use(`/api/${routeFile}`, require(`./routes/${routeFile}`));
      console.log(`✓ ${routeFile} routes loaded`);
    } catch (error) {
      console.log(`⚠ Error loading ${routeFile} routes:`, error.message);
    }
  }
});

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ message: 'Rental Management System API is running!' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!', error: err.message });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

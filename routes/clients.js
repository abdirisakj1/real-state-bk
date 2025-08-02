const express = require('express');
const Client = require('../models/Client');
const { authenticateToken, managerAccess } = require('../middleware/auth');
const router = express.Router();

// GET all clients
router.get('/', authenticateToken, managerAccess, async (req, res) => {
  const clients = await Client.find().populate('property');
  res.json({ clients });
});

// POST new client
router.post('/', authenticateToken, managerAccess, async (req, res) => {
  const client = new Client(req.body);
  await client.save();
  res.status(201).json({ client });
});

// Update client
router.put('/:id', authenticateToken, managerAccess, async (req, res) => {
  const client = await Client.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!client) return res.status(404).json({ message: 'Client not found' });
  res.json({ client });
});

// Delete client
router.delete('/:id', authenticateToken, managerAccess, async (req, res) => {
  const client = await Client.findByIdAndDelete(req.params.id);
  if (!client) return res.status(404).json({ message: 'Client not found' });
  res.json({ message: 'Client deleted' });
});

module.exports = router;

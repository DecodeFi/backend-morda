const https = require('https');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const app = express();
const PORT = 3443;

// Load environment variables from ../config/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const LOGIC_SERVER_URL = 'http://localhost:5566';
const SECURITY_SERVER_URL = 'http://localhost:7777';
const PUBLIC_SERVER_URL = 'https://localhost:3443';

// PostgreSQL connection setup using .env config
const pool = new Pool({
	user: process.env.POSTGRES_USER,
	host: process.env.POSTGRES_HOST,
	database: process.env.POSTGRES_DB,
	password: process.env.POSTGRES_PASSWORD,
	port: process.env.POSTGRES_PORT,
});

const options = {
	key: fs.readFileSync('./private.key'),
	cert: fs.readFileSync('./certificate.crt')
};

// Enable CORS for all routes
app.use(cors());

const swaggerOptions = {
	definition: {
		openapi: '3.0.0',
		info: {
			title: 'GraphChain API',
			version: '1.0.0',
			description: 'API documentation for GraphChain backend',
		},
	},
	apis: [path.join(__dirname, '*.js')], // or wherever your routes are
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


/**
 * @swagger
 * /api/blockNumber:
 *   get:
 *     summary: Get the latest block number
 *     description: Returns the latest block number from the logic server.
 *     responses:
 *       200:
 *         description: Latest block number
 *       500:
 *         description: Error fetching block number
 */
// Route to get the latest block number
app.get('/api/blockNumber', async (req, res) => {
	try {
		const response = await axios.get(`${LOGIC_SERVER_URL}/block_number`);
		res.send(response.data);
	} catch (error) {
		console.error('Error proxying /blockNumber:', error.message);
		res.status(500).send('Error fetching block number');
	}
});

/**
 * @swagger
 * /api/block/{blockNumber}:
 *   get:
 *     summary: Get transactions for a specific block
 *     description: Returns all transactions for the specified block number.
 *     parameters:
 *       - in: path
 *         name: blockNumber
 *         required: true
 *         schema:
 *           type: integer
 *         description: The block number
 *     responses:
 *       200:
 *         description: Transactions for the block
 *       500:
 *         description: Error fetching block transactions
 */
// Route to get transactions for a specific block
app.get('/api/block/:blockNumber', async (req, res) => {
	const blockNumber = req.params.blockNumber;
	try {
		const response = await axios.get(`${LOGIC_SERVER_URL}/block/${blockNumber}`);
		res.send(response.data);
	} catch (error) {
		console.error(`Error proxying /block/${blockNumber}:`, error.message);
		res.status(500).send('Error fetching block transactions');
	}
});

/**
 * @swagger
 * /api/trace:
 *   get:
 *     summary: Get traces for an address, transaction, or block
 *     description: Returns traces for a given address, transaction, or block. Only one parameter should be provided at a time.
 *     parameters:
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Address to get traces for
 *       - in: query
 *         name: tx
 *         schema:
 *           type: string
 *         description: Transaction hash to get traces for
 *       - in: query
 *         name: block
 *         schema:
 *           type: integer
 *         description: Block number to get traces for
 *     responses:
 *       200:
 *         description: Traces and metadata
 *       400:
 *         description: Missing or invalid query parameters
 *       404:
 *         description: Not found
 *       500:
 *         description: Internal server error
 */
// Route to get traces for an address, transaction, or block
app.get('/api/trace', async (req, res) => {
	const { address, tx, block } = req.query;

	try {
		let traces = [];
		
		if (address) {
			try {
				const response = await axios.get(`${LOGIC_SERVER_URL}/trace_address/${address}`);
				traces = response.data;
			} catch (err) {
				console.error(err);
				return res.status(404).json({ error: 'Address not found' });
			}
		} else if (tx) {
			return res.status(501).json({
				error: 'Transaction lookup not implemented',
				message: 'The transaction lookup feature is not currently supported'
			});
		} else if (block) {
			try {
				const response = await axios.get(`${LOGIC_SERVER_URL}/trace_block/${block}`);
				traces = response.data;
			} catch (err) {
				console.error(err);
				return res.status(404).json({ error: 'Block not found' });
			}
		} else {
			return res.status(400).json({ error: 'Provide address, tx, or block in query params' });
		}
		
		// Extract unique addresses from traces
		const uniqueAddresses = new Set();
		traces.forEach(trace => {
			if (trace.from_addr) uniqueAddresses.add(trace.from_addr);
			if (trace.to_addr) uniqueAddresses.add(trace.to_addr);
			if (trace.storage_addr) uniqueAddresses.add(trace.storage_addr);
		});
		
		const addressList = [...uniqueAddresses];
		
		// Fetch metadata for unique addresses
		let metadata = {};
		if (addressList.length > 0) {
			try {
				// First, get basic address information
				const addressQuery = 'SELECT address, contract_name, protocol_id FROM addresses WHERE address = ANY($1)';
				const addressResult = await pool.query(addressQuery, [addressList]);
				
				// Group addresses by protocol_id to find snapshots
				const addressesByProtocol = {};
				addressResult.rows.forEach(row => {
					if (row.protocol_id) {
						if (!addressesByProtocol[row.protocol_id]) {
							addressesByProtocol[row.protocol_id] = [];
						}
						addressesByProtocol[row.protocol_id].push(row.address);
					}
					
					// Initialize metadata with basic info
					metadata[row.address] = {
						contract_name: row.contract_name
					};
				});
				
				// Add entries for addresses that don't have metadata in the database
				addressList.forEach(addr => {
					if (!metadata[addr]) {
						metadata[addr] = {
							contract_name: null
						};
					}
				});
			} catch (dbError) {
				console.error('Error fetching address metadata:', dbError);
				// We'll continue even if metadata fetch fails, just with an empty metadata object
			}
		}
		
		// Return combined data
		res.json({
			'traces': traces,
			'metadata': metadata
		});
		
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

/**
 * @swagger
 * /api/metadata/address/{address}:
 *   get:
 *     summary: Get metadata for a single address
 *     description: Returns metadata for the specified address, including protocol information if available.
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: The address to fetch metadata for
 *     responses:
 *       200:
 *         description: Address metadata
 *       404:
 *         description: Address not found
 *       500:
 *         description: Error fetching address metadata
 */
// Route to get metadata for a single address
app.get('/api/metadata/address/:address', async (req, res) => {
	const address = req.params.address;
	
	try {
		// Check if the address parameter contains multiple addresses separated by commas
		const addresses = address.split(',');
		
		if (addresses.length === 1) {
			// Original behavior for a single address
			const query = `
				SELECT a.*, p.protocol_name, p.protocol_symbol, p.protocol_type 
				FROM addresses a
				LEFT JOIN protocols p ON a.protocol_id = p.protocol_id
				WHERE a.address = $1
			`;
			const result = await pool.query(query, [address]);
			
			if (result.rows.length === 0) {
				return res.status(404).json({ error: 'Address not found' });
			}
			
			res.json(result.rows[0]);
		} else {
			// Handle multiple addresses
			const placeholders = addresses.map((_, index) => `$${index + 1}`).join(',');
			const query = `
				SELECT a.*, p.protocol_name, p.protocol_symbol, p.protocol_type 
				FROM addresses a
				LEFT JOIN protocols p ON a.protocol_id = p.protocol_id
				WHERE a.address IN (${placeholders})
			`;
			const result = await pool.query(query, addresses);
			
			// Create a map of address to metadata
			const metadataMap = {};
			result.rows.forEach(row => {
				metadataMap[row.address] = row;
			});
			
			res.json(metadataMap);
		}
	} catch (error) {
		console.error('Error fetching address metadata:', error);
		res.status(500).json({ error: error.message });
	}
});

/**
 * @swagger
 * /api/metadata/protocol/{protocolId}:
 *   get:
 *     summary: Get all addresses for a specific protocol
 *     description: Returns protocol information and all associated addresses for the specified protocol ID.
 *     parameters:
 *       - in: path
 *         name: protocolId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The protocol ID
 *     responses:
 *       200:
 *         description: Protocol info and addresses
 *       404:
 *         description: Protocol not found
 *       500:
 *         description: Error fetching protocol metadata
 */
// Route to get all addresses for a specific protocol
app.get('/api/metadata/protocol/:protocolId', async (req, res) => {
	const protocolId = req.params.protocolId;
	
	try {
		// First, get protocol information
		const protocolQuery = 'SELECT * FROM protocols WHERE protocol_id = $1';
		const protocolResult = await pool.query(protocolQuery, [protocolId]);
		
		if (protocolResult.rows.length === 0) {
			return res.status(404).json({ error: 'Protocol not found' });
		}
		
		// Then get all addresses for this protocol
		const addressesQuery = 'SELECT * FROM addresses WHERE protocol_id = $1';
		const addressesResult = await pool.query(addressesQuery, [protocolId]);
		
		// Return protocol info and its addresses
		res.json({
			protocol: protocolResult.rows[0],
			addresses: addressesResult.rows
		});
	} catch (error) {
		console.error('Error fetching protocol metadata:', error);
		res.status(500).json({ error: error.message });
	}
});

/**
 * @swagger
 * /api/metadata/protocols:
 *   get:
 *     summary: Get all protocols
 *     description: Returns a list of all protocols.
 *     responses:
 *       200:
 *         description: List of protocols
 *       500:
 *         description: Error fetching protocols
 */
// Route to get all protocols
app.get('/api/metadata/protocols', async (req, res) => {
	try {
		const query = 'SELECT * FROM protocols ORDER BY protocol_name';
		const result = await pool.query(query);
		res.json(result.rows);
	} catch (error) {
		console.error('Error fetching protocols:', error);
		res.status(500).json({ error: error.message });
	}
});

/**
 * @swagger
 * /api/metadata/protocol:
 *   post:
 *     summary: Create a new protocol
 *     description: Creates a new protocol with the provided information.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               protocolName:
 *                 type: string
 *               protocolSymbol:
 *                 type: string
 *               protocolType:
 *                 type: string
 *               mainAddress:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Protocol created
 *       400:
 *         description: Protocol name is required
 *       500:
 *         description: Error creating protocol
 */
// Route to create a new protocol
app.post('/api/metadata/protocol', express.json(), async (req, res) => {
	const { protocolName, protocolSymbol, protocolType, mainAddress, description } = req.body;
	
	if (!protocolName) {
		return res.status(400).json({ error: 'Protocol name is required' });
	}
	
	try {
		const query = `
			INSERT INTO protocols (protocol_name, protocol_symbol, protocol_type, main_address, description)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING *
		`;
		const result = await pool.query(query, [
			protocolName,
			protocolSymbol || null,
			protocolType || null,
			mainAddress || null,
			description || null
		]);
		
		res.status(201).json(result.rows[0]);
	} catch (error) {
		console.error('Error creating protocol:', error);
		res.status(500).json({ error: error.message });
	}
});

/**
 * @swagger
 * /api/addresses/snapshot:
 *   post:
 *     summary: Create or update a snapshot with node coordinates
 *     description: Creates a new snapshot or updates an existing one with node coordinates.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               snapshot_name:
 *                 type: string
 *               snapshot_nodes:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     x:
 *                       type: number
 *                     y:
 *                       type: number
 *                     address:
 *                       type: string
 *     responses:
 *       200:
 *         description: Snapshot created/updated successfully
 *       400:
 *         description: Invalid request body
 *       500:
 *         description: Error creating/updating snapshot
 */
app.post('/api/addresses/snapshot', express.json(), async (req, res) => {
	const { snapshot_name, snapshot_nodes } = req.body;
	
	if (!snapshot_name || !Array.isArray(snapshot_nodes)) {
		return res.status(400).json({ error: 'Invalid request body. snapshot_name and snapshot_nodes array are required' });
	}

	try {
		// Begin transaction
		await pool.query('BEGIN');

		// Check if snapshot exists
		const checkSnapshotQuery = 'SELECT id FROM snapshots WHERE name = $1';
		const existingSnapshot = await pool.query(checkSnapshotQuery, [snapshot_name]);

		if (existingSnapshot.rows.length > 0) {
			// Delete existing snapshot and its nodes
			const deleteNodesQuery = 'DELETE FROM snapshot_nodes WHERE snapshot_id = $1';
			await pool.query(deleteNodesQuery, [existingSnapshot.rows[0].id]);
			
			const deleteSnapshotQuery = 'DELETE FROM snapshots WHERE id = $1';
			await pool.query(deleteSnapshotQuery, [existingSnapshot.rows[0].id]);
		}

		// Create new snapshot
		const createSnapshotQuery = 'INSERT INTO snapshots (name) VALUES ($1) RETURNING id';
		const newSnapshot = await pool.query(createSnapshotQuery, [snapshot_name]);
		const snapshotId = newSnapshot.rows[0].id;

		// Insert all nodes
		for (const node of snapshot_nodes) {
			if (node.x === undefined || node.y === undefined || node.address === undefined) {
				await pool.query('ROLLBACK');
				return res.status(400).json({ error: 'Each node must have x, y, and address properties' });
			}

			const insertNodeQuery = `
				INSERT INTO snapshot_nodes (x, y, address, snapshot_id)
				VALUES ($1, $2, $3, $4)
			`;
			await pool.query(insertNodeQuery, [node.x, node.y, node.address, snapshotId]);
		}

		// Commit transaction
		await pool.query('COMMIT');

		res.json({
			success: true,
			message: 'Snapshot created/updated successfully',
			snapshot_id: snapshotId
		});
	} catch (error) {
		// Rollback on error
		await pool.query('ROLLBACK');
		console.error('Error creating/updating snapshot:', error);
		res.status(500).json({ error: error.message });
	}
});

/**
 * @swagger
 * /api/security/check/{address}:
 *   get:
 *     summary: Get security check for address
 *     description: Returns security check results for an address. If not available, performs a security check via external service.
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Ethereum address to check
 *     responses:
 *       200:
 *         description: Security check results
 *       400:
 *         description: Invalid address format
 *       500:
 *         description: Error performing security check
 */
app.get('/api/security/check/:address', async (req, res) => {
	const address = req.params.address;
	
	// Basic validation for Ethereum address
	if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
		return res.status(400).json({ error: 'Invalid Ethereum address format' });
	}
	
	try {
		// Check if we already have security data for this address
		const checkExistingQuery = 'SELECT * FROM security_check WHERE address = $1';
		const existingResult = await pool.query(checkExistingQuery, [address]);
		
		if (existingResult.rows.length > 0) {
			// Return existing security check data
			return res.json({
				address: existingResult.rows[0].address,
				score: existingResult.rows[0].score,
				reports: existingResult.rows[0].reports,
				cached: true
			});
		}
		
		// If not found, request security check from external service
		try {
			const address_metadata = await axios.get(`${PUBLIC_SERVER_URL}/api/metadata/address/${address}`, {
				httpsAgent: new https.Agent({  
					rejectUnauthorized: false
				})
			});
			const securityResponse = await axios.post(`${SECURITY_SERVER_URL}`, address_metadata.data);
			console.log(securityResponse.data);

			if (!securityResponse.data || !securityResponse.data.score || !securityResponse.data.reports) {
				throw new Error('Invalid response from security service');
			}
			
			const { reports, score } = securityResponse.data;
			
			// Store the security check result in the database
			const insertQuery = `
				INSERT INTO security_check (address, score, reports)
				VALUES ($1, $2, $3::jsonb)
				RETURNING *
			`;
			const insertResult = await pool.query(insertQuery, [
				address, 
				score, 
				JSON.stringify(reports)
			]);
			
			return res.json({
				address: insertResult.rows[0].address,
				score: insertResult.rows[0].score,
				reports: insertResult.rows[0].reports,
				cached: false
			});
			
		} catch (serviceError) {
			console.error('Error checking security service:', serviceError);
			return res.status(500).json({ 
				error: 'Error contacting security service',
				details: serviceError.message
			});
		}
		
	} catch (error) {
		console.error('Error performing security check:', error);
		res.status(500).json({ error: error.message });
	}
});

/**
 * @swagger
 * /api/snapshot/{snapshotName}:
 *   get:
 *     summary: Get all nodes and traces for a specific snapshot
 *     description: Returns all addresses with their coordinates and traces between them for a given snapshot name.
 *     parameters:
 *       - in: path
 *         name: snapshotName
 *         required: true
 *         schema:
 *           type: string
 *         description: The name of the snapshot
 *     responses:
 *       200:
 *         description: List of nodes with coordinates and their traces
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 snapshot_name:
 *                   type: string
 *                   description: The name of the snapshot
 *                 snapshot_id:
 *                   type: integer
 *                   description: The ID of the snapshot
 *                 nodes:
 *                   type: array
 *                   description: List of addresses with their coordinates
 *                   items:
 *                     type: object
 *                     properties:
 *                       node_id:
 *                         type: integer
 *                       x:
 *                         type: integer
 *                       y:
 *                         type: integer
 *                       address:
 *                         type: string
 *                 traces:
 *                   type: array
 *                   description: List of traces between addresses, including both normal calls (with from_addr) and delegate calls (with storage_addr)
 *                   items:
 *                     type: object
 *                     oneOf:
 *                       - properties:
 *                           from_addr:
 *                             type: string
 *                             description: Source address for normal calls (call, create, create2)
 *                           to_addr:
 *                             type: string
 *                           count:
 *                             type: integer
 *                       - properties:
 *                           storage_addr:
 *                             type: string
 *                             description: Storage address for delegate calls
 *                           to_addr:
 *                             type: string
 *                           count:
 *                             type: integer
 *       404:
 *         description: Snapshot not found
 *       500:
 *         description: Error retrieving snapshot data
 */
app.get('/api/snapshot/:snapshotName', async (req, res) => {
	const snapshotName = req.params.snapshotName;
	
	try {
		// First get the snapshot ID
		const snapshotQuery = 'SELECT id FROM snapshots WHERE name = $1';
		const snapshotResult = await pool.query(snapshotQuery, [snapshotName]);
		
		if (snapshotResult.rows.length === 0) {
			return res.status(404).json({ error: 'Snapshot not found' });
		}
		
		const snapshotId = snapshotResult.rows[0].id;
		
		// Then get all nodes for this snapshot
		const nodesQuery = 'SELECT node_id, x, y, address FROM snapshot_nodes WHERE snapshot_id = $1';
		const nodesResult = await pool.query(nodesQuery, [snapshotId]);
		
		// Extract all addresses from nodes
		const addresses = nodesResult.rows.map(node => node.address);
		
		// If no addresses found, return just the empty nodes
		if (addresses.length === 0) {
			return res.json({
				snapshot_name: snapshotName,
				snapshot_id: snapshotId,
				nodes: [],
				traces: []
			});
		}
		
		// Get normal call traces between these addresses
		const normalCallsQuery = `
			SELECT from_addr, to_addr, action
			FROM traces 
			WHERE action IN ('call', 'create', 'create2') 
			AND from_addr = ANY($1) 
			AND to_addr = ANY($1)
			GROUP BY from_addr, to_addr, action
		`;
		const normalCallsResult = await pool.query(normalCallsQuery, [addresses]);
		
		// Get delegate call traces between these addresses
		const delegateCallsQuery = `
			SELECT storage_addr, to_addr, action
			FROM traces 
			WHERE action IN ('delegate_call') 
			AND storage_addr = ANY($1) 
			AND to_addr = ANY($1)
			GROUP BY storage_addr, to_addr, action
		`;
		const delegateCallsResult = await pool.query(delegateCallsQuery, [addresses]);
		
		// Combine both types of traces
		const traces = [
			// Process normal calls
			...normalCallsResult.rows.map(trace => ({
				from_addr: trace.from_addr,
				to_addr: trace.to_addr,
				action: trace.action
			})),
			// Process delegate calls with original field names
			...delegateCallsResult.rows.map(trace => ({
				storage_addr: trace.storage_addr,
				to_addr: trace.to_addr,
				action: trace.action
			}))
		];
		
		// Return the snapshot data with all its nodes and traces
		res.json({
			snapshot_name: snapshotName,
			snapshot_id: snapshotId,
			nodes: nodesResult.rows,
			traces: traces
		});
		
	} catch (error) {
		console.error('Error retrieving snapshot data:', error);
		res.status(500).json({ error: error.message });
	}
});

// Start server
https.createServer(options, app).listen(PORT, () => {
	console.log(`Proxy server listening on port ${PORT}`);
});

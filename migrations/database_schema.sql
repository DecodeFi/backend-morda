-- Blocks are stored separately and simply
CREATE TABLE blocks (
    block_number BIGINT PRIMARY KEY,
    block_timestamp TIMESTAMP,
    block_hash VARCHAR(66) UNIQUE NOT NULL
);

-- Main traces table
-- TODO: optimize index
CREATE TABLE traces (
    trace_id VARCHAR(70) PRIMARY KEY,
    tx_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    from_addr VARCHAR(42) NOT NULL,
    to_addr VARCHAR(42) NOT NULL,
    storage_addr VARCHAR(42) NOT NULL,
    value VARCHAR(32) NOT NULL,
    action VARCHAR(16) NOT NULL,
    call_data BYTEA DEFAULT NULL
);


-- Tokens table to group related addresses
CREATE TABLE protocols (
    protocol_id SERIAL PRIMARY KEY,
    protocol_name VARCHAR(255) NOT NULL,
    protocol_symbol VARCHAR(50),
    protocol_type VARCHAR(50),
    description TEXT
);

-- Addresses table
CREATE TABLE addresses (
    address VARCHAR(42) PRIMARY KEY,
    is_contract BOOLEAN DEFAULT FALSE,
    is_proxy BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    contract_bytecode BYTEA DEFAULT NULL,
    contract_source_code TEXT DEFAULT NULL,
    contract_abi TEXT DEFAULT NULL,
    contract_name VARCHAR(255) DEFAULT NULL,
    compiler_version VARCHAR(255) DEFAULT NULL,
    constructor_arguments TEXT DEFAULT NULL,
    license_type VARCHAR(255) DEFAULT NULL,
    protocol_id INTEGER REFERENCES protocols(protocol_id) ON DELETE SET NULL,
    CONSTRAINT fk_protocol
        FOREIGN KEY(protocol_id)
        REFERENCES protocols(protocol_id)
        ON DELETE SET NULL
);

CREATE TABLE snapshots (
    id SERIAL PRIMARY KEY, 
    protocol_id INTEGER REFERENCES protocols(protocol_id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    CONSTRAINT fk_protocol
        FOREIGN KEY(protocol_id)
        REFERENCES protocols(protocol_id)
        ON DELETE SET NULL
);

CREATE TABLE snapshot_nodes (
   node_id SERIAL PRIMARY KEY,
   x INTEGER NOT NULL,
   y INTEGER NOT NULL, 
   address VARCHAR(42) NOT NULL,
   snapshot_id INTEGER REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE TABLE security_check (
   address VARCHAR(42) PRIMARY KEY,
   score INTEGER NOT NULL,
   reports JSONB NOT NULL
)


CREATE INDEX idx_traces_tx_hash ON traces (tx_hash);
CREATE INDEX idx_traces_block_number ON traces (block_number);
CREATE INDEX idx_traces_from_addr ON traces (from_addr);
CREATE INDEX idx_traces_to_addr ON traces (to_addr);
CREATE INDEX idx_traces_storage_addr ON traces (storage_addr);
CREATE INDEX idx_addresses_protocol_id ON addresses (protocol_id);

import requests
import psycopg2
import time
import json
import os
from dotenv import load_dotenv

load_dotenv('../../.env')

API_KEY = "D72RRESEC5N5EH5TG7RYXYWA5H81AGQV44"
ETHERSCAN_URL = "https://api.etherscan.io/api"

def get_bytecode(address):
    params = {
        "module": "proxy",
        "action": "eth_getCode",
        "address": address,
        "apikey": API_KEY
    }
    try:
        r = requests.get(ETHERSCAN_URL, params=params, timeout=10)
        data = r.json()
        bytecode = data.get("result")
        if bytecode == "0x" or bytecode is None:
            return False, None  # EOA
        return True, bytecode
    except Exception as e:
        print(f"Bytecode fetch error for {address}: {e}")
        return False, None

def get_contract_metadata(address):
    params = {
        "module": "contract",
        "action": "getsourcecode",
        "address": address,
        "apikey": API_KEY
    }
    try:
        r = requests.get(ETHERSCAN_URL, params=params, timeout=10)
        data = r.json()
        result = data["result"][0]
        return {
            "is_verified": result["ABI"] != "Contract source code not verified",
            "contract_source_code": result.get("SourceCode") or None,
            "contract_abi": result.get("ABI") if result["ABI"] != "Contract source code not verified" else None,
            "contract_name": result.get("ContractName") or None,
            "compiler_version": result.get("CompilerVersion") or None,
            "constructor_arguments": result.get("ConstructorArguments") or None,
            "license_type": result.get("LicenseType") or None,
            "is_proxy": result.get("Proxy") == "1"
        }
    except Exception as e:
        print(f"Metadata fetch error for {address}: {e}")
        return None

def upsert(conn, metadata):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO addresses (
                address, is_contract, is_proxy, is_verified,
                contract_bytecode, contract_source_code, contract_abi, contract_name,
                compiler_version, constructor_arguments, license_type
            )
            VALUES (
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s
            )
            ON CONFLICT (address) DO UPDATE SET
                is_contract = EXCLUDED.is_contract,
                is_proxy = EXCLUDED.is_proxy,
                is_verified = EXCLUDED.is_verified,
                contract_bytecode = EXCLUDED.contract_bytecode,
                contract_source_code = EXCLUDED.contract_source_code,
                contract_abi = EXCLUDED.contract_abi,
                contract_name = EXCLUDED.contract_name,
                compiler_version = EXCLUDED.compiler_version,
                constructor_arguments = EXCLUDED.constructor_arguments,
                license_type = EXCLUDED.license_type;
        """, (
            metadata.get("address"),
            metadata.get("is_contract", False),
            metadata.get("is_proxy", False),
            metadata.get("is_verified", False),
            metadata.get("contract_bytecode", None),
            metadata.get("contract_source_code", None),
            metadata.get("contract_abi", None),
            metadata.get("contract_name", None),
            metadata.get("compiler_version", None),
            metadata.get("constructor_arguments", None),
            metadata.get("license_type", None),
        ))
        
        conn.commit()

def load_addresses(conn):
    unique_addresses = set()

    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT from_addr FROM traces
                UNION
                SELECT DISTINCT to_addr FROM traces
                WHERE to_addr IS NOT NULL
                UNION
                SELECT DISTINCT storage_addr FROM traces
                WHERE storage_addr IS NOT NULL
            """)
            
            for row in cur:
                address = row[0]
                if address:
                    unique_addresses.add(address.lower())
    
    finally:
        pass
    
    print(f"Extracted {len(unique_addresses)} unique addresses from traces")
    return list(unique_addresses)

def check_address(conn, address):
    with conn.cursor() as cur:
        cur.execute("SELECT address FROM addresses WHERE address = %s", (address,))
        return cur.fetchone() is not None

def main():
    print("Starting address enrichment")
    print(f"Connecting to database: {os.getenv('POSTGRES_DB')}@{os.getenv('POSTGRES_HOST')}")

    conn = psycopg2.connect(
        dbname=os.getenv('POSTGRES_DB'), user=os.getenv('POSTGRES_USER'), password=os.getenv('POSTGRES_PASSWORD'), host=os.getenv('POSTGRES_HOST')
    )
    addresses = load_addresses(conn)
    for i, address in enumerate(addresses, 1):
        print(f"[{i}/{len(addresses)}] Processing {address}")
        if check_address(conn, address):
            print(f"  {address} already exists in the database")
            continue

        is_ctr, bytecode = get_bytecode(address)
        metadata = {'address': address}
        if is_ctr:
            contract_metadata = get_contract_metadata(address)
            if(not contract_metadata):
                continue
            
            metadata.update(contract_metadata)
            metadata["is_contract"] = True
            metadata["contract_bytecode"] = bytes.fromhex(bytecode[2:])
        
        # DEBUG
        # for key, value in metadata.items():
        #     if isinstance(value, str) and len(value) > 100:
        #         print(f"  {key}: {value[:100]}...")
        #     else:
        #         print(f"  {key}: {value}")
        
        upsert(conn, metadata)
        time.sleep(0.25)  # Etherscan rate limit
    conn.close()

main()

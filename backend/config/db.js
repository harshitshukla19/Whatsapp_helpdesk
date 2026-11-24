const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || '1433', 10),
options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
    useUTC: false // GETDATE() in schema.sql stores local (IST) wall-clock time,
                   // not UTC — without this, tedious mislabels it as UTC on
                   // read and every timestamp shows 5:30 ahead in the browser
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let poolPromise = null;

/**
 * Returns a shared MSSQL connection pool. Always reuse this -
 * never create a new ConnectionPool() per controller.
 */
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        console.log('MSSQL connected');
        return pool;
      })
      .catch((err) => {
        poolPromise = null; // allow retry on next call
        console.error('MSSQL connection error:', err);
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { getPool, sql };
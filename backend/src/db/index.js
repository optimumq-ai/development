const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/optimumq.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

function initDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  schema.split(';').map(function(s){ return s.trim(); }).filter(function(s){ return s.length>0; }).forEach(function(stmt){
    try { db.prepare(stmt).run(); } catch(e) {}
  });
  console.log('Database initialized:', DB_PATH);
  return db;
}

function getDb() { if (!db) throw new Error('DB not initialized'); return db; }

function all(sql, params) {
  var p = params || [];
  if (!Array.isArray(p)) p = [p];
  return getDb().prepare(sql).all(...p);
}

function get(sql, params) {
  var p = params || [];
  if (!Array.isArray(p)) p = [p];
  return getDb().prepare(sql).get(...p) || null;
}

function run(sql, params) {
  var p = params || [];
  if (!Array.isArray(p)) p = [p];
  return getDb().prepare(sql).run(...p);
}

function transaction(fn) {
  return getDb().transaction(fn)();
}

function persist() {}

module.exports = { initDb: initDb, getDb: getDb, all: all, get: get, run: run, transaction: transaction, persist: persist };

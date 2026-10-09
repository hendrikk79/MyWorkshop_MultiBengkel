// =====================================================
// MYWORKSHOP - DATABASE
// =====================================================

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const configuredDbPath = String(process.env.MYWORKSHOP_DB_PATH || "").trim();
const databaseDir = configuredDbPath
    ? path.dirname(path.resolve(configuredDbPath))
    : path.join(__dirname, "..", "database");

if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, {
        recursive: true
    });
}

const dbPath = configuredDbPath
    ? path.resolve(configuredDbPath)
    : path.join(databaseDir, "myworkshop.db");

const db = new Database(dbPath);

db.pragma("foreign_keys = ON");

// =====================================================
// ROLES
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS roles (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    name TEXT NOT NULL UNIQUE,

    description TEXT,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP

);
`);

// =====================================================
// USERS
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS users (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    username TEXT NOT NULL UNIQUE,

    password_hash TEXT NOT NULL,

    full_name TEXT,

    role_id INTEGER,

    is_active INTEGER NOT NULL
        DEFAULT 1,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (role_id)
        REFERENCES roles(id)

);
`);

// =====================================================
// RIWAYAT PENGHAPUSAN ESTIMASI / WO
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS deletion_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_type TEXT NOT NULL,
    document_id INTEGER,
    document_number TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    customer_name TEXT,
    insurer_alias TEXT,
    reason TEXT NOT NULL,
    deleted_by INTEGER,
    workshop_id INTEGER NOT NULL,
    FOREIGN KEY (deleted_by) REFERENCES users(id)
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_deletion_history_workshop_date
ON deletion_history(workshop_id, deleted_at);
`);

// =====================================================
// CUSTOMERS
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS customers (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    customer_code TEXT NOT NULL UNIQUE,

    name TEXT NOT NULL,

    phone TEXT,

    customer_type TEXT NOT NULL
        DEFAULT 'INDIVIDUAL',

    address TEXT,

    notes TEXT,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP

);
`);

// =====================================================
// ASURANSI
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS insurers (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    code TEXT NOT NULL UNIQUE,

    name TEXT NOT NULL UNIQUE,

    alias TEXT,

    npwp TEXT,

    phone TEXT,

    email TEXT,

    address TEXT,

    material_percent REAL NOT NULL
        DEFAULT 0,

    is_active INTEGER NOT NULL
        DEFAULT 1,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP

);
`);

// =====================================================
// KENDARAAN
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS vehicles (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    customer_id INTEGER NOT NULL,

    plate_number TEXT NOT NULL,

    brand TEXT,

    model TEXT,

    year INTEGER,

    color TEXT,

    vin_number TEXT,

    engine_number TEXT,

    notes TEXT,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE RESTRICT

);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_vehicles_customer
ON vehicles(customer_id);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_vehicles_plate
ON vehicles(plate_number);
`);

// =====================================================
// ESTIMASI
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS estimates (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    estimate_number TEXT NOT NULL UNIQUE,

    estimate_date TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    customer_id INTEGER NOT NULL,

    vehicle_id INTEGER NOT NULL,

    insurer_id INTEGER,

    status TEXT NOT NULL
        DEFAULT 'DRAFT',

    customer_note TEXT,

    subtotal_sparepart REAL NOT NULL
        DEFAULT 0,

    discount_sparepart REAL NOT NULL
        DEFAULT 0,

    total_sparepart REAL NOT NULL
        DEFAULT 0,

    total_jasa REAL NOT NULL
        DEFAULT 0,

    total_jasa_lain REAL NOT NULL
        DEFAULT 0,

    subtotal REAL NOT NULL
        DEFAULT 0,

    discount REAL NOT NULL
        DEFAULT 0,

    total_after_discount REAL NOT NULL
        DEFAULT 0,

    ppn_percent REAL NOT NULL
        DEFAULT 0,

    ppn_type TEXT NOT NULL
        DEFAULT 'NONE',

    ppn_amount REAL NOT NULL
        DEFAULT 0,

    pph_percent REAL NOT NULL
        DEFAULT 2,

    labour_percent REAL NOT NULL
        DEFAULT 100,

    labour_amount REAL NOT NULL
        DEFAULT 0,

    pph_amount REAL NOT NULL
        DEFAULT 0,

    own_risk REAL NOT NULL
        DEFAULT 0,

    grand_total REAL NOT NULL
        DEFAULT 0,

    total_billed REAL NOT NULL
        DEFAULT 0,

    created_by INTEGER,

    approved_at TEXT,

    approved_by INTEGER,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (customer_id)
        REFERENCES customers(id),

    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(id),

    FOREIGN KEY (insurer_id)
        REFERENCES insurers(id),

    FOREIGN KEY (created_by)
        REFERENCES users(id),

    FOREIGN KEY (approved_by)
        REFERENCES users(id)

);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_estimates_customer
ON estimates(customer_id);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_estimates_vehicle
ON estimates(vehicle_id);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_estimates_insurer
ON estimates(insurer_id);
`);

// =====================================================
// MIGRATION ESTIMASI - MATERIAL / LABOUR
// =====================================================
const estimateColumns = db.prepare(`PRAGMA table_info(estimates)`).all().map(column => column.name);
if (!estimateColumns.includes("material_percent")) {
    db.exec(`ALTER TABLE estimates ADD COLUMN material_percent REAL NOT NULL DEFAULT 0`);
}
if (!estimateColumns.includes("claim_number")) {
    db.exec(`ALTER TABLE estimates ADD COLUMN claim_number TEXT`);
}
if (!estimateColumns.includes("polis_number")) {
    db.exec(`ALTER TABLE estimates ADD COLUMN polis_number TEXT`);
}
if (!estimateColumns.includes("agent")) {
    db.exec(`ALTER TABLE estimates ADD COLUMN agent TEXT`);
}

// =====================================================
// MIGRATION ASURANSI - NPWP / MATERIAL : LABOUR
// =====================================================
const insurerColumns = db.prepare(`PRAGMA table_info(insurers)`).all().map(column => column.name);
if (!insurerColumns.includes("alias")) {
    db.exec(`ALTER TABLE insurers ADD COLUMN alias TEXT`);
}
if (!insurerColumns.includes("npwp")) {
    db.exec(`ALTER TABLE insurers ADD COLUMN npwp TEXT`);
}
if (!insurerColumns.includes("material_percent")) {
    db.exec(`ALTER TABLE insurers ADD COLUMN material_percent REAL NOT NULL DEFAULT 0`);
}

// =====================================================
// ESTIMASI - SPAREPART
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS estimate_spareparts (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    estimate_id INTEGER NOT NULL,

    part_name TEXT NOT NULL,

    part_number TEXT,

    quantity REAL NOT NULL
        DEFAULT 1,

    unit TEXT NOT NULL
        DEFAULT 'PCS',

    unit_price REAL NOT NULL
        DEFAULT 0,

    discount REAL NOT NULL
        DEFAULT 0,

    total_price REAL NOT NULL
        DEFAULT 0,

    sequence INTEGER NOT NULL
        DEFAULT 1,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (estimate_id)
        REFERENCES estimates(id)
        ON DELETE CASCADE

);
`);

// Pilihan sumber Sparepart / Material pada WO: BENGKEL atau SUPPLY.
const estimateSparepartColumns = db.prepare(`PRAGMA table_info(estimate_spareparts)`).all().map(c => c.name);
if (!estimateSparepartColumns.includes("supply_bengkel")) {
    db.exec(`ALTER TABLE estimate_spareparts ADD COLUMN supply_bengkel TEXT NOT NULL DEFAULT 'BENGKEL'`);
}


// =====================================================
// ESTIMASI - JASA
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS estimate_services (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    estimate_id INTEGER NOT NULL,

    panel_name TEXT NOT NULL,

    service_type TEXT NOT NULL,

    quantity REAL NOT NULL
        DEFAULT 1,

    unit TEXT NOT NULL
        DEFAULT 'JOB',

    unit_price REAL NOT NULL
        DEFAULT 0,

    discount REAL NOT NULL
        DEFAULT 0,

    total_price REAL NOT NULL
        DEFAULT 0,

    sequence INTEGER NOT NULL
        DEFAULT 1,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (estimate_id)
        REFERENCES estimates(id)
        ON DELETE CASCADE

);
`);

// =====================================================
// ESTIMASI - JASA LAIN
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS estimate_other_services (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    estimate_id INTEGER NOT NULL,

    service_name TEXT NOT NULL,

    quantity REAL NOT NULL
        DEFAULT 1,

    unit TEXT NOT NULL
        DEFAULT 'JOB',

    unit_price REAL NOT NULL
        DEFAULT 0,

    discount REAL NOT NULL
        DEFAULT 0,

    total_price REAL NOT NULL
        DEFAULT 0,

    sequence INTEGER NOT NULL
        DEFAULT 1,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (estimate_id)
        REFERENCES estimates(id)
        ON DELETE CASCADE

);
`);

// =====================================================
// WO
// WO SELALU DIBUAT DARI ESTIMASI
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS wo (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    wo_number TEXT NOT NULL UNIQUE,

    estimate_id INTEGER NOT NULL UNIQUE,

    status TEXT NOT NULL
        DEFAULT 'CHECK IN',

    kilometer REAL,

    check_in_at TEXT,

    pengerjaan_at TEXT,

    selesai_at TEXT,

    check_out_at TEXT,

    notes TEXT,

    created_by INTEGER,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (estimate_id)
        REFERENCES estimates(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (created_by)
        REFERENCES users(id)

);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_wo_estimate
ON wo(estimate_id);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_wo_status
ON wo(status);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_wo_check_in
ON wo(check_in_at);
`);

// =====================================================
// MIGRATION AMAN
// =====================================================

const woColumns = db.prepare(`
    PRAGMA table_info(wo)
`).all();

const hasTargetDate = woColumns.some(
    column => column.name === "target_date"
);

if (!hasTargetDate) {
    db.exec(`
        ALTER TABLE wo
        ADD COLUMN target_date TEXT
    `);
}

// CHECK OUT pertama harus tetap tersimpan walaupun WO melakukan CHECK IN AGAIN.
let woSchemaColumns = db.prepare(`PRAGMA table_info(wo)`).all().map(column => column.name);
if (!woSchemaColumns.includes("first_check_out_at")) {
    db.exec(`ALTER TABLE wo ADD COLUMN first_check_out_at TEXT`);
}

// Tahap produksi tambahan.
const currentWOColumns = db.prepare(`PRAGMA table_info(wo)`).all().map(column => column.name);
for (const columnName of ["dempul_at", "cat_at", "finishing_at"]) {
    if (!currentWOColumns.includes(columnName)) {
        db.exec(`ALTER TABLE wo ADD COLUMN ${columnName} TEXT`);
    }
}

// Keterangan Progress aktif WO. Terisolasi mengikuti WO/bengkel.
let woProgressColumns = db.prepare(`PRAGMA table_info(wo)`).all().map(column => column.name);
if (!woProgressColumns.includes("progress_note")) {
    db.exec(`ALTER TABLE wo ADD COLUMN progress_note TEXT`);
}

// =====================================================
// SERVICE TYPE
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS service_types (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    code TEXT NOT NULL UNIQUE,

    name TEXT NOT NULL,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP

);
`);


// =====================================================
// TAGIHAN OWN RISK (OR) - RINGKASAN TAGIHAN / FREE OR
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS own_risk_billing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wo_id INTEGER NOT NULL UNIQUE,
    free_amount REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wo_id) REFERENCES wo(id) ON DELETE CASCADE
);
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_or_billing_wo ON own_risk_billing(wo_id);`);

// =====================================================
// TAGIHAN OWN RISK (OR) - PEMBAYARAN
// Pembayaran terhubung langsung ke WO.
// Nilai OR selalu diambil dari estimates.own_risk.
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS own_risk_payments (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    wo_id INTEGER NOT NULL,

    payment_method TEXT NOT NULL,

    amount REAL NOT NULL DEFAULT 0,

    description TEXT,

    paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    created_by INTEGER,

    FOREIGN KEY (wo_id)
        REFERENCES wo(id)
        ON DELETE CASCADE,

    FOREIGN KEY (created_by)
        REFERENCES users(id)

);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_or_payments_wo
ON own_risk_payments(wo_id);
`);

// =====================================================
// TAGIHAN KUITANSI
// Satu kuitansi per WO yang sudah CHECK OUT.
// =====================================================
db.exec(`
CREATE TABLE IF NOT EXISTS tagihan_kuitansi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wo_id INTEGER NOT NULL UNIQUE,
    total_jasa_perbaikan REAL NOT NULL DEFAULT 0,
    material_percent REAL NOT NULL DEFAULT 0,
    labour_percent REAL NOT NULL DEFAULT 100,
    material_amount REAL NOT NULL DEFAULT 0,
    labour_amount REAL NOT NULL DEFAULT 0,
    sparepart_amount REAL NOT NULL DEFAULT 0,
    jasa_lain_amount REAL NOT NULL DEFAULT 0,
    ppn_percent REAL NOT NULL DEFAULT 0,
    ppn_type TEXT NOT NULL DEFAULT 'SPAREPART_JASA',
    ppn_base REAL NOT NULL DEFAULT 0,
    ppn_amount REAL NOT NULL DEFAULT 0,
    pph_percent REAL NOT NULL DEFAULT 2,
    pph_amount REAL NOT NULL DEFAULT 0,
    own_risk REAL NOT NULL DEFAULT 0,
    salvage_amount REAL NOT NULL DEFAULT 0,
    system_fee REAL NOT NULL DEFAULT 0,
    total_before_deductions REAL NOT NULL DEFAULT 0,
    grand_total REAL NOT NULL DEFAULT 0,
    payable_percent REAL NOT NULL DEFAULT 100,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wo_id) REFERENCES wo(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_tagihan_kuitansi_wo
ON tagihan_kuitansi(wo_id);
`);

// =====================================================
// PEMBAYARAN KUITANSI
// Satu data pembayaran untuk setiap WO yang sudah memiliki kuitansi.
// =====================================================
db.exec(`
CREATE TABLE IF NOT EXISTS pembayaran_kuitansi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wo_id INTEGER NOT NULL UNIQUE,
    paid_at TEXT NOT NULL,
    description TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wo_id) REFERENCES wo(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_pembayaran_kuitansi_wo
ON pembayaran_kuitansi(wo_id);
`);

// =====================================================
// MIGRATION TAGIHAN KUITANSI - REFERENSI ASURANSI
// =====================================================
const tagihanKuitansiColumns = db.prepare(`PRAGMA table_info(tagihan_kuitansi)`).all().map(c => c.name);
for (const columnName of ["claim_number", "polis_number", "bank_account_id", "bank_name", "bank_account_number", "bank_account_name"]) {
    if (!tagihanKuitansiColumns.includes(columnName)) {
        db.exec(`ALTER TABLE tagihan_kuitansi ADD COLUMN ${columnName} TEXT`);
    }
}

// =====================================================
// STOK SPAREPART - BARANG MASUK
// Data stok berasal dari transaksi input Sparepart Masuk.
// =====================================================
db.exec(`
CREATE TABLE IF NOT EXISTS sparepart_stock_in (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date TEXT NOT NULL,
    part_number TEXT NOT NULL,
    part_name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'PCS',
    purchase_price REAL NOT NULL DEFAULT 0,
    supplier TEXT,
    vehicle_brand TEXT,
    vehicle_type TEXT,
    vehicle_year TEXT,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_sparepart_stock_in_part
ON sparepart_stock_in(part_number);
`);

// Migrasi kolom peruntukan Barang Masuk.
const stockInColumns = db.prepare(`PRAGMA table_info(sparepart_stock_in)`).all().map(c => c.name);
for (const columnName of ["vehicle_brand", "vehicle_type", "vehicle_year"]) {
    if (!stockInColumns.includes(columnName)) {
        db.exec(`ALTER TABLE sparepart_stock_in ADD COLUMN ${columnName} TEXT`);
    }
}

// =====================================================
// STOK SPAREPART - BARANG KELUAR
// Menyimpan transaksi pengeluaran sparepart dari stok.
// =====================================================
db.exec(`
CREATE TABLE IF NOT EXISTS sparepart_stock_out (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exit_date TEXT NOT NULL,
    part_number TEXT NOT NULL,
    part_name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'PCS',
    purchase_price REAL NOT NULL DEFAULT 0,
    supplier TEXT,
    vehicle_brand TEXT,
    vehicle_type TEXT,
    vehicle_year TEXT,
    reference TEXT,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_sparepart_stock_out_part
ON sparepart_stock_out(part_number);
`);

const stockOutColumns = db.prepare(`PRAGMA table_info(sparepart_stock_out)`).all().map(c => c.name);
for (const columnName of ["vehicle_brand", "vehicle_type", "vehicle_year"]) {
    if (!stockOutColumns.includes(columnName)) {
        db.exec(`ALTER TABLE sparepart_stock_out ADD COLUMN ${columnName} TEXT`);
    }
}

// =====================================================
// WO - RIWAYAT PROSES PRODUKSI / CHECK IN AGAIN
// Menyimpan setiap perpindahan status agar proses berulang
// tetap terlihat lengkap pada Detail WO.
// =====================================================

db.exec(`
CREATE TABLE IF NOT EXISTS wo_process_history (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    wo_id INTEGER NOT NULL,

    cycle_no INTEGER NOT NULL DEFAULT 1,

    status TEXT NOT NULL,

    note TEXT,

    changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (wo_id)
        REFERENCES wo(id)
        ON DELETE CASCADE

);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_wo_history_wo
ON wo_process_history(wo_id, id);
`);

// Keterangan tambahan yang diinput dari menu WO Selesai.
// Dipisahkan dari wo.notes agar Keterangan Check Out tetap utuh.
try {
    const woColumns = db.prepare(`PRAGMA table_info(wo)`).all().map(c => c.name);
    if (!woColumns.includes("completed_note")) {
        db.exec(`ALTER TABLE wo ADD COLUMN completed_note TEXT`);
        console.log("Kolom wo.completed_note berhasil ditambahkan.");
    }
} catch (error) {
    console.error("MIGRASI WO COMPLETED NOTE ERROR:", error);
}




// Backfill WO lama yang sudah pernah CHECK OUT.
db.exec(`
    UPDATE wo
    SET first_check_out_at = COALESCE(
        first_check_out_at,
        (SELECT MIN(h.changed_at) FROM wo_process_history h WHERE h.wo_id = wo.id AND UPPER(TRIM(h.status)) = 'CHECK OUT'),
        check_out_at
    )
    WHERE first_check_out_at IS NULL
      AND (check_out_at IS NOT NULL OR EXISTS (SELECT 1 FROM wo_process_history h WHERE h.wo_id = wo.id AND UPPER(TRIM(h.status)) = 'CHECK OUT'));
`);


// Backfill Estimasi Selesai untuk Kuitansi yang sudah pernah dibuat.
// Ini memperbaiki data lama agar integrasi tetap konsisten setelah upgrade.
db.exec(`
    UPDATE estimates
    SET status = 'SELESAI', updated_at = CURRENT_TIMESTAMP
    WHERE id IN (
        SELECT w.estimate_id
        FROM wo w
        INNER JOIN tagihan_kuitansi tk ON tk.wo_id = w.id
        WHERE w.estimate_id IS NOT NULL
    )
    AND UPPER(TRIM(COALESCE(status, ''))) <> 'SELESAI';
`);


// =====================================================
// VENDOR PRODUKSI / TUKANG
// Harga pekerja per WO dan jenis pekerjaan.
// =====================================================
db.exec(`
CREATE TABLE IF NOT EXISTS production_worker_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wo_id INTEGER NOT NULL,
    worker_name TEXT NOT NULL DEFAULT '',
    worker_type TEXT NOT NULL,
    worker_price REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wo_id) REFERENCES wo(id) ON DELETE CASCADE,
    UNIQUE (wo_id, worker_type)
);
`);

// Kompatibilitas database lama: tambahkan nama pekerja jika kolom belum ada.
const productionWorkerColumns = db.prepare(`PRAGMA table_info(production_worker_prices)`).all().map(c => c.name);
if (!productionWorkerColumns.includes('worker_name')) {
    db.exec(`ALTER TABLE production_worker_prices ADD COLUMN worker_name TEXT NOT NULL DEFAULT ''`);
}

db.exec(`
CREATE INDEX IF NOT EXISTS idx_production_worker_prices_wo
ON production_worker_prices(wo_id);
`);

// =====================================================
// PEMBAYARAN VENDOR PRODUKSI
// Satu pembayaran untuk setiap WO setelah seluruh harga pekerja
// (Ketok, Dempul, Cat, Poles) sudah diinput.
// =====================================================
db.exec(`
CREATE TABLE IF NOT EXISTS vendor_production_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wo_id INTEGER NOT NULL UNIQUE,
    paid_at TEXT NOT NULL,
    description TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wo_id) REFERENCES wo(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_vendor_production_payments_wo
ON vendor_production_payments(wo_id);
`);


// =====================================================
// PEMAKAIAN BAHAN
// Pemakaian bahan/material operasional per WO.
// =====================================================
db.exec(`
CREATE TABLE IF NOT EXISTS material_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wo_id INTEGER NOT NULL,
    material_code TEXT NOT NULL,
    material_name TEXT NOT NULL,
    brand_name TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wo_id) REFERENCES wo(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_material_usage_wo
ON material_usage(wo_id, material_code);
`);

// =====================================================
// MOBIL MASUK
// Data kendaraan yang baru datang sebelum masuk proses Estimasi/WO.
// =====================================================
db.exec(`
CREATE TABLE IF NOT EXISTS mobil_masuk (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate_number TEXT NOT NULL,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    color TEXT NOT NULL,
    created_by INTEGER,
    used_estimate_id INTEGER,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (used_estimate_id) REFERENCES estimates(id)
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_mobil_masuk_available
ON mobil_masuk(used_at, id);
`);

// =====================================================
// CENTRAL APP STORAGE
// Data pendukung modul yang belum memiliki tabel transaksi khusus
// tetap disimpan di database pusat yang sama.
// =====================================================
db.exec(`
CREATE TABLE IF NOT EXISTS app_storage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storage_key TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    updated_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    workshop_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(storage_key, workshop_id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_app_storage_key
ON app_storage(storage_key);
`);

// =====================================================
// SERVER SESSIONS
// Session autentikasi disimpan di database agar login tidak
// bergantung pada localStorage dan tetap dapat diverifikasi backend.
// =====================================================
db.exec(`
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    actor_user_id INTEGER,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash
ON user_sessions(token_hash);
`);

const userSessionCols = db.prepare(`PRAGMA table_info(user_sessions)`).all().map(x => x.name);
if (!userSessionCols.includes("actor_user_id")) {
    db.exec(`ALTER TABLE user_sessions ADD COLUMN actor_user_id INTEGER`);
}


db.exec(`
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
ON user_sessions(user_id);
`);



// =====================================================
// MULTI BENGKEL - CORE MIGRATION
// Model B: satu instalasi untuk banyak bengkel.
// =====================================================
db.exec(`
CREATE TABLE IF NOT EXISTS workshops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workshop_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    email TEXT,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Migrasi identitas bengkel: email dipakai pada kop dokumen dan data bengkel Super Admin.
const workshopColumns = db.prepare(`PRAGMA table_info(workshops)`).all().map(x => x.name);
if (!workshopColumns.includes('email')) {
    db.exec(`ALTER TABLE workshops ADD COLUMN email TEXT`);
}

// Bengkel awal untuk mempertahankan seluruh data instalasi lama.
const firstWorkshop = db.prepare(`SELECT id FROM workshops ORDER BY id ASC LIMIT 1`).get();
if (!firstWorkshop) {
    db.prepare(`INSERT INTO workshops (workshop_code, name) VALUES (?, ?)`).run('BKL-0001', 'Bengkel Utama');
}
const defaultWorkshopId = Number(db.prepare(`SELECT id FROM workshops ORDER BY id ASC LIMIT 1`).get().id);

// Semua data operasional diberi workshop_id. DEFAULT 1 menjaga database lama tetap hidup;
// setelah migrasi, user/workshop baru menggunakan id bengkel masing-masing.
const workshopTables = [
    'users','app_storage','document_history','customers','insurers','vehicles','estimates',
    'estimate_spareparts','estimate_services','estimate_other_services','mobil_masuk','wo',
    'wo_process_history','own_risk_payments','own_risk_billing','pembayaran_kuitansi','production_vendor_payments',
    'production_worker_prices','vendor_production_payments','material_usage','tagihan_kuitansi',
    'sparepart_stock_in','sparepart_stock_out','deletion_history'
];
for (const table of workshopTables) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(x => x.name);
    if (!cols.includes('workshop_id')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN workshop_id INTEGER NOT NULL DEFAULT ${defaultWorkshopId}`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_workshop_id ON ${table}(workshop_id)`);
}

// =====================================================
// ISOLASI NAMA ASURANSI PER BENGKEL
// Database lama memiliki UNIQUE(name) secara global.
// Nama yang sama harus boleh digunakan oleh bengkel berbeda,
// sehingga constraint yang benar adalah UNIQUE(name, workshop_id).
// Kode asuransi tetap UNIQUE secara global.
// =====================================================
try {
    const insurerIndexes = db.prepare(`PRAGMA index_list(insurers)`).all();
    const hasGlobalUniqueName = insurerIndexes.some(index => {
        if (!Number(index.unique)) return false;
        const columns = db.prepare(`PRAGMA index_info(\"${String(index.name).replace(/\"/g, '""')}\")`).all();
        return columns.length === 1 && String(columns[0]?.name || '') === 'name';
    });

    if (hasGlobalUniqueName) {
        db.pragma('foreign_keys = OFF');
        try {
            // Trigger isolasi estimasi -> insurers merujuk tabel insurers.
            // Trigger dibuat ulang oleh server.js setelah database siap.
            db.exec(`
                DROP TRIGGER IF EXISTS trg_estimate_insurer_workshop;
                DROP TRIGGER IF EXISTS trg_estimate_insurer_workshop_update;

                CREATE TABLE insurers_mw_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    alias TEXT,
                    npwp TEXT,
                    phone TEXT,
                    email TEXT,
                    address TEXT,
                    material_percent REAL NOT NULL DEFAULT 0,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    notes TEXT DEFAULT '',
                    workshop_id INTEGER NOT NULL DEFAULT ${defaultWorkshopId},
                    UNIQUE(name, workshop_id)
                );

                INSERT INTO insurers_mw_new
                    (id,code,name,alias,npwp,phone,email,address,material_percent,is_active,created_at,updated_at,notes,workshop_id)
                SELECT
                    id,code,name,alias,npwp,phone,email,address,material_percent,is_active,created_at,updated_at,COALESCE(notes,''),COALESCE(workshop_id,${defaultWorkshopId})
                FROM insurers;

                DROP TABLE insurers;
                ALTER TABLE insurers_mw_new RENAME TO insurers;
                CREATE INDEX IF NOT EXISTS idx_insurers_workshop_id ON insurers(workshop_id);
            `);
        } finally {
            db.pragma('foreign_keys = ON');
        }
        console.log('Migrasi isolasi insurers berhasil: nama asuransi unik per bengkel.');
    }
} catch (error) {
    console.error('Migrasi isolasi insurers gagal:', error);
}

// Isolasi app_storage: data operasional harus unik per bengkel.
try {
    const indexes = db.prepare(`PRAGMA index_list(app_storage)`).all();
    const singleKeyUnique = indexes.some(idx => {
        if (!Number(idx.unique)) return false;
        const cols = db.prepare(`PRAGMA index_info(${String(idx.name).replace(/"/g, '""')})`).all();
        return cols.length === 1 && String(cols[0]?.name || '') === 'storage_key';
    });
    if (singleKeyUnique) {
        db.exec(`
            CREATE TABLE app_storage_mw_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                storage_key TEXT NOT NULL,
                data_json TEXT NOT NULL DEFAULT '{}',
                updated_by INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                workshop_id INTEGER NOT NULL DEFAULT ${defaultWorkshopId},
                UNIQUE(storage_key, workshop_id),
                FOREIGN KEY (updated_by) REFERENCES users(id)
            );
            INSERT INTO app_storage_mw_new (id,storage_key,data_json,updated_by,created_at,updated_at,workshop_id)
            SELECT id,storage_key,data_json,updated_by,created_at,updated_at,COALESCE(workshop_id,${defaultWorkshopId}) FROM app_storage;
            DROP TABLE app_storage;
            ALTER TABLE app_storage_mw_new RENAME TO app_storage;
            CREATE INDEX IF NOT EXISTS idx_app_storage_key ON app_storage(storage_key);
            CREATE INDEX IF NOT EXISTS idx_app_storage_workshop_id ON app_storage(workshop_id);
        `);
    }
} catch (error) {
    console.error('Migrasi isolasi app_storage gagal:', error);
}

// Role code/description sudah ada pada database baseline; tambahkan kolom code bila database lama belum memilikinya.
const roleCols = db.prepare(`PRAGMA table_info(roles)`).all().map(x => x.name);
if (!roleCols.includes('code')) db.exec(`ALTER TABLE roles ADD COLUMN code TEXT`);
const roleSeed = [
    ['SUPER_ADMIN','SUPER ADMIN','Pengelola seluruh instalasi dan seluruh bengkel.'],
    ['MANAGER_MASTER','MANAGER MASTER','Akses penuh pada satu bengkel.'],
    ['SERVICE_ADVISOR','SERVICE ADVISOR','Akses Transaksi dan Produksi.'],
    ['BILLING','BILLING','Akses Billing dan Laporan.'],
    ['SPAREPART_GUDANG','SPAREPART GUDANG','Akses Sparepart/Gudang.']
];
for (const [code,name,description] of roleSeed) {
    let row = db.prepare(`SELECT id FROM roles WHERE UPPER(COALESCE(code,'')) = UPPER(?) OR UPPER(name)=UPPER(?) LIMIT 1`).get(code,name);
    if (!row) {
        db.prepare(`INSERT INTO roles (code,name,description) VALUES (?,?,?)`).run(code,name,description);
    } else {
        db.prepare(`UPDATE roles SET code=?, name=?, description=? WHERE id=?`).run(code,name,description,row.id);
    }
}

// User lama dianggap Manager Master Bengkel Utama agar data lama tetap dapat dipakai.
const mmRole = db.prepare(`SELECT id FROM roles WHERE code='MANAGER_MASTER' LIMIT 1`).get();
if (mmRole) db.prepare(`UPDATE users SET workshop_id=? WHERE COALESCE(workshop_id,0)=0 OR workshop_id IS NULL`).run(defaultWorkshopId);

// Super Admin pertama dibuat otomatis hanya bila belum ada.
const saRole = db.prepare(`SELECT id FROM roles WHERE code='SUPER_ADMIN' LIMIT 1`).get();
if (saRole) {
    const existing = db.prepare(`SELECT id FROM users WHERE role_id=? LIMIT 1`).get(saRole.id);
    if (!existing) {
        const bcrypt = require('bcryptjs');
        db.prepare(`INSERT INTO users (username,password_hash,full_name,role_id,is_active,workshop_id) VALUES (?,?,?,?,1,?)`)
          .run('superadmin', bcrypt.hashSync('SuperAdmin123!',10), 'Super Admin', saRole.id, defaultWorkshopId);
    }
}

module.exports = db;
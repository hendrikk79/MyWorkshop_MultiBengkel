const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const db = require("./database");


// ============================================================
// AUDIT LOG
// Catatan aktivitas penting sistem. Bersifat append-only dari aplikasi.
// ============================================================
try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id INTEGER,
            workshop_id INTEGER,
            action TEXT NOT NULL,
            module TEXT,
            detail TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
} catch (error) {
    console.error("AUDIT LOG INIT ERROR:", error);
}

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS document_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_type TEXT NOT NULL,
            document_id INTEGER NOT NULL,
            document_number TEXT,
            action TEXT NOT NULL,
            changes_json TEXT,
            before_json TEXT,
            after_json TEXT,
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            workshop_id INTEGER NOT NULL DEFAULT 1
        )
    `);
} catch (error) {
    console.error("DOCUMENT HISTORY INIT ERROR:", error);
}


// ============================================================
// STRICT MULTI-WORKSHOP DATABASE ISOLATION
//
// workshop_id pada data operasional bukan sekadar filter tampilan.
// Semua child record diturunkan dari parent bengkel dan relasi antar
// tabel lintas-bengkel ditolak di level database. Ini menjadi lapisan
// kedua setelah pemeriksaan session/API.
// ============================================================
function initializeWorkshopIsolation() {
    const statements = [
        // Perbaiki data detail lama: workshop_id harus mengikuti parent.
        `UPDATE vehicles SET workshop_id=(SELECT workshop_id FROM customers WHERE customers.id=vehicles.customer_id) WHERE EXISTS (SELECT 1 FROM customers WHERE customers.id=vehicles.customer_id)`,
        `UPDATE estimate_spareparts SET workshop_id=(SELECT workshop_id FROM estimates WHERE estimates.id=estimate_spareparts.estimate_id) WHERE EXISTS (SELECT 1 FROM estimates WHERE estimates.id=estimate_spareparts.estimate_id)`,
        `UPDATE estimate_services SET workshop_id=(SELECT workshop_id FROM estimates WHERE estimates.id=estimate_services.estimate_id) WHERE EXISTS (SELECT 1 FROM estimates WHERE estimates.id=estimate_services.estimate_id)`,
        `UPDATE estimate_other_services SET workshop_id=(SELECT workshop_id FROM estimates WHERE estimates.id=estimate_other_services.estimate_id) WHERE EXISTS (SELECT 1 FROM estimates WHERE estimates.id=estimate_other_services.estimate_id)`,
        `UPDATE wo_process_history SET workshop_id=(SELECT workshop_id FROM wo WHERE wo.id=wo_process_history.wo_id) WHERE EXISTS (SELECT 1 FROM wo WHERE wo.id=wo_process_history.wo_id)`,
        `UPDATE tagihan_kuitansi SET workshop_id=(SELECT workshop_id FROM wo WHERE wo.id=tagihan_kuitansi.wo_id) WHERE EXISTS (SELECT 1 FROM wo WHERE wo.id=tagihan_kuitansi.wo_id)`,
        `UPDATE pembayaran_kuitansi SET workshop_id=(SELECT workshop_id FROM wo WHERE wo.id=pembayaran_kuitansi.wo_id) WHERE EXISTS (SELECT 1 FROM wo WHERE wo.id=pembayaran_kuitansi.wo_id)`,
        `UPDATE material_usage SET workshop_id=(SELECT workshop_id FROM wo WHERE wo.id=material_usage.wo_id) WHERE EXISTS (SELECT 1 FROM wo WHERE wo.id=material_usage.wo_id)`,
        `UPDATE production_worker_prices SET workshop_id=(SELECT workshop_id FROM wo WHERE wo.id=production_worker_prices.wo_id) WHERE EXISTS (SELECT 1 FROM wo WHERE wo.id=production_worker_prices.wo_id)`,
        `UPDATE vendor_production_payments SET workshop_id=(SELECT workshop_id FROM wo WHERE wo.id=vendor_production_payments.wo_id) WHERE EXISTS (SELECT 1 FROM wo WHERE wo.id=vendor_production_payments.wo_id)`,
        `UPDATE own_risk_billing SET workshop_id=(SELECT workshop_id FROM wo WHERE wo.id=own_risk_billing.wo_id) WHERE EXISTS (SELECT 1 FROM wo WHERE wo.id=own_risk_billing.wo_id)`,
        `UPDATE own_risk_payments SET workshop_id=(SELECT workshop_id FROM wo WHERE wo.id=own_risk_payments.wo_id) WHERE EXISTS (SELECT 1 FROM wo WHERE wo.id=own_risk_payments.wo_id)`,
        `UPDATE document_history SET workshop_id=(SELECT workshop_id FROM estimates WHERE estimates.id=document_history.document_id) WHERE UPPER(document_type)='ESTIMASI' AND EXISTS (SELECT 1 FROM estimates WHERE estimates.id=document_history.document_id)`,
        `UPDATE document_history SET workshop_id=(SELECT workshop_id FROM wo WHERE wo.id=document_history.document_id) WHERE UPPER(document_type)='WO' AND EXISTS (SELECT 1 FROM wo WHERE wo.id=document_history.document_id)`,
        `UPDATE document_history SET workshop_id=(SELECT workshop_id FROM tagihan_kuitansi WHERE tagihan_kuitansi.id=document_history.document_id) WHERE UPPER(document_type) IN ('KUITANSI','TAGIHAN_KUITANSI') AND EXISTS (SELECT 1 FROM tagihan_kuitansi WHERE tagihan_kuitansi.id=document_history.document_id)`,

        // Indexes make the mandatory workshop predicates cheap.
        `CREATE INDEX IF NOT EXISTS idx_customers_workshop_id ON customers(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_insurers_workshop_id ON insurers(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_vehicles_workshop_id ON vehicles(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_estimates_workshop_id ON estimates(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_estimate_spareparts_workshop_id ON estimate_spareparts(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_estimate_services_workshop_id ON estimate_services(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_estimate_other_services_workshop_id ON estimate_other_services(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_wo_workshop_id ON wo(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_wo_history_workshop_id ON wo_process_history(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_tagihan_kuitansi_workshop_id ON tagihan_kuitansi(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_pembayaran_kuitansi_workshop_id ON pembayaran_kuitansi(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_material_usage_workshop_id ON material_usage(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_production_worker_prices_workshop_id ON production_worker_prices(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_vendor_production_payments_workshop_id ON vendor_production_payments(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_own_risk_billing_workshop_id ON own_risk_billing(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_own_risk_payments_workshop_id ON own_risk_payments(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_mobil_masuk_workshop_id ON mobil_masuk(workshop_id)`,
        `CREATE INDEX IF NOT EXISTS idx_document_history_workshop_id ON document_history(workshop_id)`
    ];

    for (const sql of statements) {
        try { db.exec(sql); } catch (error) { console.error('WORKSHOP ISOLATION MIGRATION ERROR:', sql, error.message); }
    }

    const triggers = [
        [`trg_vehicle_customer_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_vehicle_customer_workshop
            BEFORE INSERT ON vehicles
            WHEN EXISTS (SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND COALESCE(c.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'Customer dan kendaraan berasal dari bengkel berbeda.'); END`],
        [`trg_estimate_customer_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_customer_workshop
            BEFORE INSERT ON estimates
            WHEN EXISTS (SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND COALESCE(c.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'Customer dan estimasi berasal dari bengkel berbeda.'); END`],
        [`trg_estimate_vehicle_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_vehicle_workshop
            BEFORE INSERT ON estimates
            WHEN EXISTS (SELECT 1 FROM vehicles v WHERE v.id=NEW.vehicle_id AND COALESCE(v.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'Kendaraan dan estimasi berasal dari bengkel berbeda.'); END`],
        [`trg_estimate_insurer_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_insurer_workshop
            BEFORE INSERT ON estimates
            WHEN NEW.insurer_id IS NOT NULL AND EXISTS (SELECT 1 FROM insurers i WHERE i.id=NEW.insurer_id AND COALESCE(i.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'Asuransi dan estimasi berasal dari bengkel berbeda.'); END`],
        [`trg_wo_estimate_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_wo_estimate_workshop
            BEFORE INSERT ON wo
            WHEN EXISTS (SELECT 1 FROM estimates e WHERE e.id=NEW.estimate_id AND COALESCE(e.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'Estimasi dan WO berasal dari bengkel berbeda.'); END`],
        [`trg_tagihan_wo_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_tagihan_wo_workshop
            BEFORE INSERT ON tagihan_kuitansi
            WHEN EXISTS (SELECT 1 FROM wo w WHERE w.id=NEW.wo_id AND COALESCE(w.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'WO dan Tagihan Kuitansi berasal dari bengkel berbeda.'); END`],
        [`trg_pembayaran_wo_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_pembayaran_wo_workshop
            BEFORE INSERT ON pembayaran_kuitansi
            WHEN EXISTS (SELECT 1 FROM wo w WHERE w.id=NEW.wo_id AND COALESCE(w.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'WO dan Pembayaran Kuitansi berasal dari bengkel berbeda.'); END`],
        [`trg_history_wo_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_history_wo_workshop
            AFTER INSERT ON wo_process_history
            BEGIN UPDATE wo_process_history SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`],
        [`trg_estimate_sparepart_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_sparepart_workshop
            AFTER INSERT ON estimate_spareparts
            BEGIN UPDATE estimate_spareparts SET workshop_id=(SELECT workshop_id FROM estimates WHERE id=NEW.estimate_id) WHERE id=NEW.id; END`],
        [`trg_estimate_service_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_service_workshop
            AFTER INSERT ON estimate_services
            BEGIN UPDATE estimate_services SET workshop_id=(SELECT workshop_id FROM estimates WHERE id=NEW.estimate_id) WHERE id=NEW.id; END`],
        [`trg_estimate_other_service_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_other_service_workshop
            AFTER INSERT ON estimate_other_services
            BEGIN UPDATE estimate_other_services SET workshop_id=(SELECT workshop_id FROM estimates WHERE id=NEW.estimate_id) WHERE id=NEW.id; END`],
        [`trg_material_usage_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_material_usage_workshop
            AFTER INSERT ON material_usage
            BEGIN UPDATE material_usage SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`],
        [`trg_worker_price_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_worker_price_workshop
            AFTER INSERT ON production_worker_prices
            BEGIN UPDATE production_worker_prices SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`],
        [`trg_vendor_payment_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_vendor_payment_workshop
            AFTER INSERT ON vendor_production_payments
            BEGIN UPDATE vendor_production_payments SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`],
        [`trg_or_billing_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_or_billing_workshop
            AFTER INSERT ON own_risk_billing
            BEGIN UPDATE own_risk_billing SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`],
        [`trg_or_payment_workshop`, `
            CREATE TRIGGER IF NOT EXISTS trg_or_payment_workshop
            AFTER INSERT ON own_risk_payments
            BEGIN UPDATE own_risk_payments SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`],
        [`trg_vehicle_customer_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_vehicle_customer_workshop_update
            BEFORE UPDATE OF customer_id, workshop_id ON vehicles
            WHEN EXISTS (SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND COALESCE(c.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'Customer dan kendaraan berasal dari bengkel berbeda.'); END`],
        [`trg_estimate_customer_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_customer_workshop_update
            BEFORE UPDATE OF customer_id, workshop_id ON estimates
            WHEN EXISTS (SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND COALESCE(c.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'Customer dan estimasi berasal dari bengkel berbeda.'); END`],
        [`trg_estimate_vehicle_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_vehicle_workshop_update
            BEFORE UPDATE OF vehicle_id, workshop_id ON estimates
            WHEN EXISTS (SELECT 1 FROM vehicles v WHERE v.id=NEW.vehicle_id AND COALESCE(v.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'Kendaraan dan estimasi berasal dari bengkel berbeda.'); END`],
        [`trg_estimate_insurer_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_insurer_workshop_update
            BEFORE UPDATE OF insurer_id, workshop_id ON estimates
            WHEN NEW.insurer_id IS NOT NULL AND EXISTS (SELECT 1 FROM insurers i WHERE i.id=NEW.insurer_id AND COALESCE(i.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'Asuransi dan estimasi berasal dari bengkel berbeda.'); END`],
        [`trg_wo_estimate_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_wo_estimate_workshop_update
            BEFORE UPDATE OF estimate_id, workshop_id ON wo
            WHEN EXISTS (SELECT 1 FROM estimates e WHERE e.id=NEW.estimate_id AND COALESCE(e.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'Estimasi dan WO berasal dari bengkel berbeda.'); END`],
        [`trg_tagihan_wo_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_tagihan_wo_workshop_update
            BEFORE UPDATE OF wo_id, workshop_id ON tagihan_kuitansi
            WHEN EXISTS (SELECT 1 FROM wo w WHERE w.id=NEW.wo_id AND COALESCE(w.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'WO dan Tagihan Kuitansi berasal dari bengkel berbeda.'); END`],
        [`trg_pembayaran_wo_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_pembayaran_wo_workshop_update
            BEFORE UPDATE OF wo_id, workshop_id ON pembayaran_kuitansi
            WHEN EXISTS (SELECT 1 FROM wo w WHERE w.id=NEW.wo_id AND COALESCE(w.workshop_id,0)<>COALESCE(NEW.workshop_id,0))
            BEGIN SELECT RAISE(ABORT,'WO dan Pembayaran Kuitansi berasal dari bengkel berbeda.'); END`],
        [`trg_history_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_history_workshop_update
            AFTER UPDATE OF workshop_id, wo_id ON wo_process_history
            WHEN EXISTS (SELECT 1 FROM wo w WHERE w.id=NEW.wo_id AND COALESCE(NEW.workshop_id,0)<>COALESCE(w.workshop_id,0))
            BEGIN UPDATE wo_process_history SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`],
        [`trg_estimate_sparepart_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_sparepart_workshop_update
            AFTER UPDATE OF workshop_id, estimate_id ON estimate_spareparts
            WHEN EXISTS (SELECT 1 FROM estimates e WHERE e.id=NEW.estimate_id AND COALESCE(NEW.workshop_id,0)<>COALESCE(e.workshop_id,0))
            BEGIN UPDATE estimate_spareparts SET workshop_id=(SELECT workshop_id FROM estimates WHERE id=NEW.estimate_id) WHERE id=NEW.id; END`],
        [`trg_estimate_service_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_service_workshop_update
            AFTER UPDATE OF workshop_id, estimate_id ON estimate_services
            WHEN EXISTS (SELECT 1 FROM estimates e WHERE e.id=NEW.estimate_id AND COALESCE(NEW.workshop_id,0)<>COALESCE(e.workshop_id,0))
            BEGIN UPDATE estimate_services SET workshop_id=(SELECT workshop_id FROM estimates WHERE id=NEW.estimate_id) WHERE id=NEW.id; END`],
        [`trg_estimate_other_service_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_estimate_other_service_workshop_update
            AFTER UPDATE OF workshop_id, estimate_id ON estimate_other_services
            WHEN EXISTS (SELECT 1 FROM estimates e WHERE e.id=NEW.estimate_id AND COALESCE(NEW.workshop_id,0)<>COALESCE(e.workshop_id,0))
            BEGIN UPDATE estimate_other_services SET workshop_id=(SELECT workshop_id FROM estimates WHERE id=NEW.estimate_id) WHERE id=NEW.id; END`],
        [`trg_material_usage_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_material_usage_workshop_update
            AFTER UPDATE OF workshop_id, wo_id ON material_usage
            WHEN EXISTS (SELECT 1 FROM wo w WHERE w.id=NEW.wo_id AND COALESCE(NEW.workshop_id,0)<>COALESCE(w.workshop_id,0))
            BEGIN UPDATE material_usage SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`],
        [`trg_worker_price_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_worker_price_workshop_update
            AFTER UPDATE OF workshop_id, wo_id ON production_worker_prices
            WHEN EXISTS (SELECT 1 FROM wo w WHERE w.id=NEW.wo_id AND COALESCE(NEW.workshop_id,0)<>COALESCE(w.workshop_id,0))
            BEGIN UPDATE production_worker_prices SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`],
        [`trg_vendor_payment_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_vendor_payment_workshop_update
            AFTER UPDATE OF workshop_id, wo_id ON vendor_production_payments
            WHEN EXISTS (SELECT 1 FROM wo w WHERE w.id=NEW.wo_id AND COALESCE(NEW.workshop_id,0)<>COALESCE(w.workshop_id,0))
            BEGIN UPDATE vendor_production_payments SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`],
        [`trg_or_billing_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_or_billing_workshop_update
            AFTER UPDATE OF workshop_id, wo_id ON own_risk_billing
            WHEN EXISTS (SELECT 1 FROM wo w WHERE w.id=NEW.wo_id AND COALESCE(NEW.workshop_id,0)<>COALESCE(w.workshop_id,0))
            BEGIN UPDATE own_risk_billing SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`],
        [`trg_or_payment_workshop_update`, `
            CREATE TRIGGER IF NOT EXISTS trg_or_payment_workshop_update
            AFTER UPDATE OF workshop_id, wo_id ON own_risk_payments
            WHEN EXISTS (SELECT 1 FROM wo w WHERE w.id=NEW.wo_id AND COALESCE(NEW.workshop_id,0)<>COALESCE(w.workshop_id,0))
            BEGIN UPDATE own_risk_payments SET workshop_id=(SELECT workshop_id FROM wo WHERE id=NEW.wo_id) WHERE id=NEW.id; END`]
    ];
    for (const [name, sql] of triggers) {
        try { db.exec(sql); } catch (error) { console.error(`WORKSHOP ISOLATION TRIGGER ${name} ERROR:`, error.message); }
    }
}

try { initializeWorkshopIsolation(); } catch (error) { console.error('WORKSHOP ISOLATION INIT ERROR:', error); }

function auditColumnMap() {
    const rows = db.prepare(`PRAGMA table_info(audit_logs)`).all();
    const names = new Set(rows.map(r => String(r.name || "")));
    const pick = (...candidates) => candidates.find(c => names.has(c)) || null;
    return {
        id: pick("id"),
        actor: pick("actor_user_id", "user_id", "created_by"),
        workshop: pick("workshop_id"),
        action: pick("action", "activity", "event"),
        module: pick("module", "entity_type", "section"),
        detail: pick("detail", "details", "description", "metadata"),
        ip: pick("ip_address", "ip", "client_ip"),
        userAgent: pick("user_agent", "useragent"),
        created: pick("created_at", "timestamp", "logged_at", "created_on")
    };
}

function auditModuleFromPath(pathName) {
    const path = String(pathName || "").toLowerCase();
    if (path.startsWith("/users")) return "User & Akses";
    if (path.startsWith("/super-admin/workshops")) return "Data Bengkel";
    if (path.startsWith("/super-admin/impersonate")) return "Data Bengkel";
    if (path.startsWith("/security")) return "Pengaturan Sistem";
    if (path.startsWith("/storage")) return "Pengaturan Sistem";
    if (path.startsWith("/super-admin")) return "Super Admin";
    if (path.startsWith("/estimasi")) return "Estimasi";
    if (path.startsWith("/wo")) return "WO";
    if (path.startsWith("/tagihan")) return "Tagihan";
    if (path.startsWith("/pembayaran")) return "Pembayaran";
    if (path.startsWith("/laporan")) return "Laporan";
    if (path.startsWith("/stok")) return "Sparepart/Gudang";
    if (path.startsWith("/permintaan")) return "Sparepart/Gudang";
    if (path.startsWith("/penerimaan")) return "Sparepart/Gudang";
    if (path.startsWith("/vendor")) return "Produksi";
    if (path.startsWith("/customers")) return "Customer";
    return "Sistem";
}

function recordAudit(req, action, module, detail = "") {
    try {
        const map = auditColumnMap();
        if (!map.action || !map.created) return;
        const values = {};
        const put = (column, value) => { if (column) values[column] = value; };
        put(map.actor, Number(req.user?.actor_user_id || req.user?.user_id || 0) || null);
        put(map.workshop, Number(req.user?.workshop_id || 0) || null);
        put(map.action, action);
        put(map.module, module);
        put(map.detail, detail);
        put(map.ip, clientAddress(req));
        put(map.userAgent, String(req.headers?.["user-agent"] || "").slice(0, 500) || null);
        const cols = Object.keys(values);
        const placeholders = cols.map(() => "?").join(",");
        db.prepare(`INSERT INTO audit_logs (${cols.join(",")}) VALUES (${placeholders})`).run(...cols.map(c => values[c]));
    } catch (error) {
        console.error("RECORD AUDIT LOG ERROR:", error);
    }
}


// Kolom diskon kategori Estimasi. Migrasi aman untuk database lama.
for (const column of [
    ["discount_sparepart_type", "TEXT NOT NULL DEFAULT 'PERCENT'"],
    ["discount_sparepart_value", "REAL NOT NULL DEFAULT 0"],
    ["discount_jasa_type", "TEXT NOT NULL DEFAULT 'PERCENT'"],
    ["discount_jasa_value", "REAL NOT NULL DEFAULT 0"]
]) {
    try {
        db.exec(`ALTER TABLE estimates ADD COLUMN ${column[0]} ${column[1]}`);
    } catch (error) {
        if (!String(error.message || "").toLowerCase().includes("duplicate column")) throw error;
    }
}

// Pertahankan nilai diskon lama saat database sebelumnya hanya menyimpan
// satu kolom total diskon. Nilainya dipetakan tanpa mengubah total historis.
try {
    db.exec(`
        UPDATE estimates
        SET discount_sparepart_value = CASE
                WHEN COALESCE(discount_sparepart_value, 0) = 0
                    THEN COALESCE(discount_sparepart, 0)
                ELSE discount_sparepart_value
            END,
            discount_sparepart_type = CASE
                WHEN COALESCE(discount_sparepart_value, 0) = 0 AND COALESCE(discount_sparepart, 0) > 0
                    THEN 'AMOUNT'
                ELSE discount_sparepart_type
            END,
            discount_jasa_value = CASE
                WHEN COALESCE(discount_jasa_value, 0) = 0 AND COALESCE(discount, 0) > COALESCE(discount_sparepart, 0)
                    THEN MAX(0, COALESCE(discount, 0) - COALESCE(discount_sparepart, 0))
                ELSE discount_jasa_value
            END,
            discount_jasa_type = CASE
                WHEN COALESCE(discount_jasa_value, 0) = 0 AND COALESCE(discount, 0) > COALESCE(discount_sparepart, 0)
                    THEN 'AMOUNT'
                ELSE discount_jasa_type
            END
    `);
} catch (error) {
    console.error("Migrasi diskon Estimasi gagal:", error);
}

const app = express();
const PORT = Number(process.env.MYWORKSHOP_PORT || 3000);

// Batas request dan rate limit dibuat tanpa dependency tambahan agar
// instalasi MyWorkshop tetap sama.
const BODY_LIMIT = process.env.MYWORKSHOP_BODY_LIMIT || "25mb";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();
const trustProxy = String(process.env.MYWORKSHOP_TRUST_PROXY || "").trim().toLowerCase();
if (trustProxy === "1" || trustProxy === "true" || trustProxy === "yes") {
    // Hanya aktifkan jika reverse proxy (mis. Nginx) dikontrol sendiri dan
    // dikonfigurasi untuk meneruskan X-Forwarded-* dengan benar.
    app.set("trust proxy", 1);
}


// ============================================================
// MIDDLEWARE
// ============================================================

const allowedOrigins = String(process.env.MYWORKSHOP_ALLOWED_ORIGINS || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);

// Production harus memiliki daftar origin eksplisit. Jangan pernah
// menjalankan aplikasi production dengan CORS yang tidak dikonfigurasi.
if (String(process.env.NODE_ENV || "").trim().toLowerCase() === "production" && allowedOrigins.length === 0) {
    throw new Error("MYWORKSHOP_ALLOWED_ORIGINS wajib diisi pada production.");
}

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || (process.env.NODE_ENV !== "production" && allowedOrigins.length === 0)) {
            return callback(null, true);
        }
        return callback(new Error("Origin tidak diizinkan."));
    },
    credentials: true
}));

// Batasi ukuran payload agar request berukuran sangat besar tidak dapat
// menghabiskan memory proses Node.js.
app.use(express.json({ limit: BODY_LIMIT }));

// Data API berisi informasi operasional bengkel dan tidak boleh disimpan
// oleh cache browser/proxy. Ini tidak mempengaruhi file statis frontend.
app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
});

app.use(
    express.urlencoded({
        extended: true,
        limit: BODY_LIMIT
    })
);

// Security headers dasar tanpa mengubah tampilan/fungsi frontend.
app.disable("x-powered-by");
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV === "production") {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
});

function clientAddress(req) {
    // Jangan mempercayai X-Forwarded-For kecuali deployment memang berada
    // di belakang proxy yang dikonfigurasi secara eksplisit.
    return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function loginRateLimit(req, res, next) {
    const now = Date.now();
    const key = clientAddress(req);
    const current = loginAttempts.get(key);
    if (!current || current.resetAt <= now) {
        loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
        return next();
    }
    if (current.count >= LOGIN_MAX_ATTEMPTS) {
        const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(429).json({
            success: false,
            message: "Terlalu banyak percobaan login. Silakan coba lagi beberapa saat."
        });
    }
    current.count += 1;
    next();
}

function clearLoginRateLimit(req) {
    loginAttempts.delete(clientAddress(req));
}

// Bersihkan bucket rate-limit lama agar Map tidak tumbuh tanpa batas.
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of loginAttempts.entries()) {
        if (value.resetAt <= now) loginAttempts.delete(key);
    }
}, LOGIN_WINDOW_MS).unref();


// ============================================================
// AUTHENTICATION / SESSION
// ============================================================
const SESSION_COOKIE = "myworkshop_session";
// Durasi sesi adalah idle timeout, dihitung sejak aktivitas terakhir.
const SESSION_HOURS = 8;

// Pastikan tabel session tersedia pada database lama maupun database baru.
// Tanpa tabel ini proses login akan gagal saat createSession().
try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            actor_user_id INTEGER,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`);
} catch (error) {
    console.error("USER SESSIONS INIT ERROR:", error);
    throw error;
}

function hashSessionToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(req) {
    const header = String(req.headers.cookie || "");
    const cookies = {};
    header.split(";").forEach(part => {
        const index = part.indexOf("=");
        if (index < 0) return;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (key) cookies[key] = decodeURIComponent(value);
    });
    return cookies;
}

function getSessionTimeoutHours() {
    try {
        const settings = getSystemSettings();
        const value = Number(settings?.session_duration_hours);
        return Math.max(1, Math.min(168, Number.isFinite(value) && value > 0 ? value : SESSION_HOURS));
    } catch (_) {
        return SESSION_HOURS;
    }
}

function getIdleExpiryDate() {
    return new Date(Date.now() + getSessionTimeoutHours() * 60 * 60 * 1000).toISOString();
}

function createSession(userId, actorUserId = null) {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashSessionToken(token);
    const expiresAt = getIdleExpiryDate();
    db.prepare(`
        INSERT INTO user_sessions (user_id, actor_user_id, token_hash, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(userId, actorUserId, tokenHash, expiresAt);
    return { token, expiresAt };
}

function getSessionUser(req) {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return null;

    const tokenHash = hashSessionToken(token);
    const row = db.prepare(`
        SELECT
            s.id AS session_id,
            s.user_id,
            s.actor_user_id,
            s.expires_at,
            u.username,
            u.full_name,
            u.is_active,
            u.workshop_id,
            w.name AS workshop_name,
            r.id AS role_id,
            r.code AS role_code,
            r.name AS role_name
        FROM user_sessions s
        INNER JOIN users u ON u.id = s.user_id
        INNER JOIN roles r ON r.id = u.role_id
        LEFT JOIN workshops w ON w.id = u.workshop_id
        WHERE s.token_hash = ?
        LIMIT 1
    `).get(tokenHash);

    if (!row || !Number(row.is_active)) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
        db.prepare(`DELETE FROM user_sessions WHERE id = ?`).run(row.session_id);
        return null;
    }

    const nextExpiresAt = getIdleExpiryDate();
    db.prepare(`
        UPDATE user_sessions
        SET last_seen_at = CURRENT_TIMESTAMP, expires_at = ?
        WHERE id = ?
    `).run(nextExpiresAt, row.session_id);
    row.expires_at = nextExpiresAt;
    return row;
}

function setSessionCookie(res, token, expiresAt) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Priority=High; Max-Age=${maxAge}${secure}`
    );
}

function clearSessionCookie(res) {
    res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Priority=High; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    );
}

function requireAuth(req, res, next) {
    const user = getSessionUser(req);
    if (!user) {
        return res.status(401).json({ success: false, message: "Sesi login tidak valid atau sudah berakhir." });
    }
    req.user = user;
    req.user.actor_user_id = user.actor_user_id || user.user_id;
    setSessionCookie(res, parseCookies(req)[SESSION_COOKIE], user.expires_at);
    next();
}

function requirePageAuth(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const pathname = String(req.path || "").toLowerCase();
    if (!pathname.endsWith(".html") || pathname === "/index.html") return next();
    const user = getSessionUser(req);
    if (user) {
        setSessionCookie(res, parseCookies(req)[SESSION_COOKIE], user.expires_at);
        return next();
    }
    return res.redirect("/");
}

// Bersihkan session kedaluwarsa secara berkala.
setInterval(() => {
    try {
        db.prepare(`DELETE FROM user_sessions WHERE expires_at <= ?`).run(new Date().toISOString());
    } catch (error) {
        console.error("SESSION CLEANUP ERROR:", error);
    }
}, 15 * 60 * 1000).unref();

// ============================================================
// FRONTEND
// ============================================================

app.use(requirePageAuth);

// Estimasi: tombol dibuat lebih ringkas tanpa mengubah fungsi maupun
// komponen halaman lain. Style hanya diinjeksi saat route /estimasi dibuka.
app.get(/^\/estimasi(?:\/)?$/, (req, res, next) => {
    try {
        const indexPath = path.join(__dirname, "../frontend/index.html");
        let html = fs.readFileSync(indexPath, "utf8");
        const compactEstimasiButtons = `
<style id="estimasi-compact-buttons">
/* Hanya halaman Estimasi */
body[data-estimasi-page="1"] button,
body[data-estimasi-page="1"] .btn-primary,
body[data-estimasi-page="1"] .btn-secondary,
body[data-estimasi-page="1"] .btn-danger,
body[data-estimasi-page="1"] .btn-success,
body[data-estimasi-page="1"] .btn-warning,
body[data-estimasi-page="1"] .btn-small,
body[data-estimasi-page="1"] [class*="btn-"] {
    padding: 5px 10px !important;
    min-height: 30px !important;
    font-size: 12px !important;
    line-height: 1.2 !important;
    border-radius: 6px !important;
}
</style>`;
        html = html.replace(/<\/head>/i, compactEstimasiButtons + "</head>");
        // Halaman ini adalah SPA. Jangan memakai class permanen pada <body>,
        // karena ketika berpindah ke WO tanpa reload class tersebut akan ikut terbawa.
        // Tandai body secara dinamis hanya ketika pathname sedang /estimasi.
        const estimasiPageScript = `
<script>
(function () {
    function syncEstimasiButtonScope() {
        var isEstimasi = /^\/estimasi(?:\/|$)/i.test(window.location.pathname);
        if (document.body) {
            if (isEstimasi) document.body.setAttribute('data-estimasi-page', '1');
            else document.body.removeAttribute('data-estimasi-page');
        }
    }
    var pushState = history.pushState;
    var replaceState = history.replaceState;
    history.pushState = function () {
        var r = pushState.apply(this, arguments);
        syncEstimasiButtonScope();
        return r;
    };
    history.replaceState = function () {
        var r = replaceState.apply(this, arguments);
        syncEstimasiButtonScope();
        return r;
    };
    window.addEventListener('popstate', syncEstimasiButtonScope);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncEstimasiButtonScope);
    else syncEstimasiButtonScope();
})();
</script>`;
        html = html.replace(/<\/head>/i, estimasiPageScript + "</head>");
        res.type("html").send(html);
    } catch (error) {
        next(error);
    }
});

app.use(
    express.static(
        path.join(
            __dirname,
            "../frontend"
        )
    )
);


// ============================================================
// HELPER
// ============================================================

function angka(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return 0;
    }

    const hasil = Number(value);

    return Number.isFinite(hasil)
        ? hasil
        : 0;
}


function teks(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value).trim();
}


function idValid(value) {

    const id = Number(value);

    return (
        Number.isInteger(id) &&
        id > 0
    );
}


// ============================================================
// CATAT RIWAYAT PROSES WO
// ============================================================

function recordWOHistory(woId, status, note = null) {
    const wo = db.prepare(`SELECT workshop_id FROM wo WHERE id = ? LIMIT 1`).get(woId);
    const workshopId = Number(wo?.workshop_id || 0) || null;
    const current = db.prepare(`
        SELECT COALESCE(MAX(cycle_no), 0) AS max_cycle
        FROM wo_process_history
        WHERE wo_id = ? AND workshop_id = ?
    `).get(woId, workshopId);
    const cycleNo = Math.max(1, Number(current?.max_cycle || 1));
    db.prepare(`
        INSERT INTO wo_process_history
        (wo_id, cycle_no, status, note, changed_at, workshop_id)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `).run(woId, cycleNo, status, note || null, workshopId);
}


// ============================================================
// GENERATE CUSTOMER CODE
// ============================================================

function generateCustomerCode(workshopId) {

    const wid = Number(workshopId || 0);
    const rows =
        db.prepare(`
            SELECT customer_code
            FROM customers
            WHERE customer_code IS NOT NULL
              AND workshop_id = ?
            ORDER BY id DESC
        `).all(wid);

    let nomor = 1;

    for (const row of rows) {
        const match = String(row?.customer_code || '').match(/(\d+)$/);
        if (match) {
            nomor = Math.max(nomor, parseInt(match[1], 10) + 1);
        }
    }

    return (
        "CUS-" +
        String(nomor).padStart(4, "0")
    );
}


// ============================================================
// PENOMORAN DOKUMEN PER BENGKEL
// Format: YYMM + KODE DOKUMEN (2 digit) + KODE IDENTITAS BENGKEL + 4 digit nomor.
// Nomor berurutan sepanjang tahun dan reset kembali ke 0001 pada tahun baru.
// ============================================================

const DOCUMENT_NUMBERING_KEY = "document_numbering_settings";
const DOCUMENT_NUMBERING_COUNTER_KEY = "document_numbering_counters";
const DEFAULT_DOCUMENT_NUMBERING = {
    estimate_code: "01",
    wo_code: "02",
    kuitansi_code: "03",
    number_digits: 4,
    reset_yearly: true
};

function normalizeDocumentNumberingCode(value, fallback) {
    const code = String(value ?? fallback ?? "").trim();
    if (!/^\d+$/.test(code)) {
        throw new Error("Kode dokumen harus berupa angka dan jumlah digit bebas, contoh 1, 01, 001, 12345.");
    }
    return code;
}

function getDocumentNumberingSettings(workshopId) {
    const wid = Number(workshopId || 0);
    if (!idValid(wid)) return { ...DEFAULT_DOCUMENT_NUMBERING };
    const row = db.prepare(`SELECT data_json, updated_at FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`).get(DOCUMENT_NUMBERING_KEY, wid);
    let saved = {};
    try { saved = row?.data_json ? JSON.parse(row.data_json) : {}; } catch (_) { saved = {}; }
    return {
        ...DEFAULT_DOCUMENT_NUMBERING,
        ...saved,
        estimate_code: normalizeDocumentNumberingCode(saved?.estimate_code, DEFAULT_DOCUMENT_NUMBERING.estimate_code),
        wo_code: normalizeDocumentNumberingCode(saved?.wo_code, DEFAULT_DOCUMENT_NUMBERING.wo_code),
        kuitansi_code: normalizeDocumentNumberingCode(saved?.kuitansi_code, DEFAULT_DOCUMENT_NUMBERING.kuitansi_code),
        number_digits: 4,
        reset_yearly: true
    };
}

function getDocumentTypeNumberingCode(workshopId, type) {
    const settings = getDocumentNumberingSettings(workshopId);
    if (type === "ESTIMASI") return settings.estimate_code;
    if (type === "WO") return settings.wo_code;
    if (type === "KUITANSI") return settings.kuitansi_code;
    throw new Error("Jenis dokumen tidak valid.");
}

function readDocumentNumberCounter(workshopId) {
    const wid = Number(workshopId || 0);
    const row = db.prepare(`SELECT data_json FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`).get(DOCUMENT_NUMBERING_COUNTER_KEY, wid);
    if (!row?.data_json) return {};
    try {
        const parsed = JSON.parse(row.data_json);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
}

function writeDocumentNumberCounter(workshopId, counters, userId = null) {
    db.prepare(`INSERT INTO app_storage (storage_key,data_json,updated_by,updated_at,workshop_id) VALUES (?,?,?,CURRENT_TIMESTAMP,?)
        ON CONFLICT(storage_key,workshop_id) DO UPDATE SET data_json=excluded.data_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
        .run(DOCUMENT_NUMBERING_COUNTER_KEY, JSON.stringify(counters), userId || null, Number(workshopId || 0));
}

function findExistingDocumentMaxSequence(workshopId, type, year2) {
    const wid = Number(workshopId || 0);
    const yy = String(year2).padStart(2, "0");
    let rows = [];
    if (type === "ESTIMASI") {
        rows = db.prepare(`SELECT estimate_number AS number FROM estimates WHERE workshop_id = ? AND estimate_number IS NOT NULL`).all(wid);
    } else if (type === "WO") {
        rows = db.prepare(`SELECT wo_number AS number FROM wo WHERE workshop_id = ? AND wo_number IS NOT NULL`).all(wid);
    } else if (type === "KUITANSI") {
        rows = db.prepare(`SELECT kuitansi_number AS number FROM tagihan_kuitansi WHERE workshop_id = ? AND kuitansi_number IS NOT NULL`).all(wid);
    }
    // Nomor dokumen yang sudah dihapus tetap dihitung agar nomor berikutnya
    // tidak pernah memakai ulang nomor lama.
    if (type === "ESTIMASI" || type === "WO") {
        const deletedRows = db.prepare(`
            SELECT document_number AS number
            FROM deletion_history
            WHERE workshop_id = ? AND UPPER(document_type) = ? AND document_number IS NOT NULL
        `).all(wid, type);
        rows = rows.concat(deletedRows);
    }

    const documentCode = getDocumentTypeNumberingCode(wid, type);
    const workshopCode = workshopDocumentCode(wid).replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escapeRegex(yy)}${escapeRegex(documentCode)}${escapeRegex(workshopCode)}(\\d{4})$`, "i");
    let max = 0;
    for (const row of rows) {
        const match = String(row?.number || "").trim().match(pattern);
        if (match) max = Math.max(max, Number(match[1]) || 0);
    }
    return max;
}

function nextDocumentSequence(workshopId, type, dateValue = new Date(), userId = null) {
    const wid = Number(workshopId || 0);
    const year = dateValue.getFullYear();
    const year2 = String(year).slice(-2);
    const key = `${year}:${type}`;
    const counters = readDocumentNumberCounter(wid);
    const current = Number(counters[key] || 0);
    const existingMax = current > 0 ? current : findExistingDocumentMaxSequence(wid, type, year2);
    const next = existingMax + 1;
    counters[key] = next;
    writeDocumentNumberCounter(wid, counters, userId);
    return next;
}

function buildDocumentNumber(workshopId, type, dateValue = new Date(), userId = null) {
    const yy = String(dateValue.getFullYear()).slice(-2);
    const mm = String(dateValue.getMonth() + 1).padStart(2, "0");
    const documentCode = getDocumentTypeNumberingCode(workshopId, type);
    const workshopCode = workshopDocumentCode(workshopId).replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!workshopCode) throw new Error("Kode Identitas Dokumen bengkel belum diatur.");
    const sequence = nextDocumentSequence(workshopId, type, dateValue, userId);
    return `${yy}${mm}${documentCode}${workshopCode}${String(sequence).padStart(4, "0")}`;
}

// ============================================================
// GENERATE NOMOR ESTIMASI
// ============================================================

function generateEstimateNumber(workshopId) {
    return buildDocumentNumber(workshopId, "ESTIMASI", new Date());
}

// ============================================================
// GENERATE NOMOR WO
// ============================================================

function generateWONumber(workshopId) {
    return buildDocumentNumber(workshopId, "WO", new Date());
}

// ============================================================
// HITUNG ESTIMASI
// ============================================================

function hitungEstimasi(data) {

    const spareparts =
        Array.isArray(
            data.spareparts
        )
            ? data.spareparts
            : [];


    const jasa =
        Array.isArray(
            data.jasa
        )
            ? data.jasa
            : [];


    const jasaLain =
        Array.isArray(
            data.jasa_lain
        )
            ? data.jasa_lain
            : [];


    // ========================================================
    // SPAREPART
    // ========================================================

    let totalSparepart = 0;

    spareparts.forEach(
        item => {

            const qty =
                angka(
                    item.qty ??
                    item.quantity
                );

            const harga =
                angka(
                    item.harga ??
                    item.unit_price
                );

            const diskon =
                angka(
                    item.diskon ??
                    item.discount
                );

            const bruto =
                Math.max(
                    0,
                    qty * harga
                );

            const total =
                Math.max(
                    0,
                    bruto - diskon
                );

            totalSparepart +=
                total;
        }
    );


    // ========================================================
    // JASA
    // ========================================================

    let totalJasa = 0;

    jasa.forEach(
        item => {

            const qty =
                angka(
                    item.qty ??
                    item.quantity ??
                    1
                );

            const harga =
                angka(
                    item.harga ??
                    item.jumlah ??
                    item.unit_price
                );

            const diskon =
                angka(
                    item.diskon ??
                    item.discount
                );

            const bruto =
                Math.max(
                    0,
                    qty * harga
                );

            const total =
                Math.max(
                    0,
                    bruto - diskon
                );

            totalJasa +=
                total;
        }
    );


    // ========================================================
    // JASA LAIN-LAIN
    // ========================================================

    let totalJasaLain = 0;

    jasaLain.forEach(
        item => {

            const qty =
                angka(
                    item.qty ??
                    item.quantity ??
                    1
                );

            const harga =
                angka(
                    item.harga ??
                    item.jumlah ??
                    item.unit_price
                );

            const diskon =
                angka(
                    item.diskon ??
                    item.discount
                );

            const bruto =
                Math.max(
                    0,
                    qty * harga
                );

            const total =
                Math.max(
                    0,
                    bruto - diskon
                );

            totalJasaLain +=
                total;
        }
    );


    // ========================================================
    // SUBTOTAL
    // ========================================================

    const subtotal =
        totalSparepart +
        totalJasa +
        totalJasaLain;


    // ========================================================
    // DISKON KATEGORI
    // ========================================================

    const discountSparepartType =
        teks(data.discount_sparepart_type ?? data.discountSparepartType).toUpperCase() === "AMOUNT"
            ? "AMOUNT"
            : "PERCENT";
    const discountSparepartValue = Math.max(0, angka(data.discount_sparepart_value ?? data.discountSparepartValue));
    const discountJasaType =
        teks(data.discount_jasa_type ?? data.discountJasaType).toUpperCase() === "AMOUNT"
            ? "AMOUNT"
            : "PERCENT";
    const discountJasaValue = Math.max(0, angka(data.discount_jasa_value ?? data.discountJasaValue));

    const discountSparepart = Math.min(
        totalSparepart,
        discountSparepartType === "PERCENT"
            ? totalSparepart * Math.min(100, discountSparepartValue) / 100
            : discountSparepartValue
    );
    const discountJasa = Math.min(
        totalJasa,
        discountJasaType === "PERCENT"
            ? totalJasa * Math.min(100, discountJasaValue) / 100
            : discountJasaValue
    );
    const diskon = discountSparepart + discountJasa;

    const totalSetelahDiskon = Math.max(0, subtotal - diskon);


    // ========================================================
    // PPN
    // ========================================================

    const ppnPersen =
        Math.max(
            0,
            angka(
                data.ppn_persen
            )
        );


    const ppnType =
        teks(
            data.ppn_type ??
            data.ppn_dasar
        ).toUpperCase();


    let dasarPPN = 0;


    if (
        ppnPersen > 0
    ) {

        if (
            ppnType ===
            "SPAREPART_JASA"
        ) {

            dasarPPN =
                Math.max(0, totalSparepart - discountSparepart) +
                Math.max(0, totalJasa - discountJasa);
        }

        else if (
            ppnType ===
            "COMPLETE"
        ) {

            dasarPPN =
                totalSetelahDiskon;
        }
    }


    const ppnAmount =
        dasarPPN *
        (
            ppnPersen /
            100
        );


    // ========================================================
    // MATERIAL : LABOUR
    // ========================================================

    const materialPersen = Math.max(
        0,
        Math.min(100, angka(data.material_percent))
    );

    const labourPersen =
        100 - materialPersen;

    const materialAmount =
        totalJasa *
        (
            materialPersen /
            100
        );

    const labourAmount =
        totalJasa *
        (
            labourPersen /
            100
        );


    // ========================================================
    // PPH
    // ========================================================

    const pphPersen = 2;

    const pphAmount =
        labourAmount *
        (
            pphPersen /
            100
        );


    // ========================================================
    // GRAND TOTAL
    // ========================================================

    const grandTotal =
        Math.max(
            0,
            totalSetelahDiskon +
            ppnAmount -
            pphAmount
        );


    // ========================================================
    // OWN RISK
    // ========================================================

    const ownRisk =
        Math.max(
            0,
            angka(
                data.or ??
                data.own_risk
            )
        );


    // ========================================================
    // TOTAL DITAGIHKAN
    // ========================================================

    const totalBilled =
        Math.max(
            0,
            grandTotal -
            ownRisk
        );


    return {

        subtotal_sparepart:
            totalSparepart,

        discount_sparepart:
            discountSparepart,

        discount_sparepart_type:
            discountSparepartType,

        discount_sparepart_value:
            discountSparepartValue,

        discount_jasa:
            discountJasa,

        discount_jasa_type:
            discountJasaType,

        discount_jasa_value:
            discountJasaValue,

        total_sparepart:
            totalSparepart,

        total_jasa:
            totalJasa,

        total_jasa_lain:
            totalJasaLain,

        subtotal:
            subtotal,

        discount:
            diskon,

        total_after_discount:
            totalSetelahDiskon,

        ppn_percent:
            ppnPersen,

        ppn_type:
            ppnType || "NONE",

        ppn_amount:
            ppnAmount,

        pph_percent:
            pphPersen,

        material_percent:
            materialPersen,

        material_amount:
            materialAmount,

        labour_percent:
            labourPersen,

        labour_amount:
            labourAmount,

        pph_amount:
            pphAmount,

        own_risk:
            ownRisk,

        grand_total:
            grandTotal,

        total_billed:
            totalBilled
    };
}


// ============================================================
// STATUS
// ============================================================

app.get(
    "/api/status",
    (req, res) => {

        res.json({

            success: true,

            application:
                "MyWorkshop",

            message:
                "Server MyWorkshop berhasil berjalan",

            status:
                "ONLINE"

        });
    }
);


// Semua endpoint API selain endpoint publik di bawah wajib memiliki session valid.
app.use("/api", (req, res, next) => {
    if (req.path === "/login" || req.path === "/status") return next();
    return requireAuth(req, res, next);
});

function requestWorkshopId(req) { return Number(req.user?.workshop_id || 0); }
function storageRead(req, key) {
    return db.prepare(`SELECT data_json FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`).get(String(key || ''), requestWorkshopId(req));
}
function storageWrite(req, key, json, userId) {
    return db.prepare(`INSERT INTO app_storage (storage_key,data_json,updated_by,updated_at,workshop_id) VALUES (?,?,?,CURRENT_TIMESTAMP,?)
        ON CONFLICT(storage_key,workshop_id) DO UPDATE SET data_json=excluded.data_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
        .run(String(key || ''), json, userId, requestWorkshopId(req));
}
app.use('/api/wo/:id', (req,res,next) => {
    // Middleware ini hanya untuk endpoint yang benar-benar memakai ID WO numerik.
    // Jangan memblokir endpoint lain di bawah /api/wo, seperti /api/wo/progress-report.
    const rawId = String(req.params.id || '').trim();
    if(!/^\d+$/.test(rawId)) return next();
    const id=Number(rawId);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({success:false,message:'ID WO tidak valid.'});
    const row=db.prepare(`SELECT id,workshop_id FROM wo WHERE id=? LIMIT 1`).get(id);
    if(!row) return res.status(404).json({success:false,message:'WO tidak ditemukan.'});
    if(currentRoleCode(req)!=='SUPER ADMIN' && Number(row.workshop_id||0)!==requestWorkshopId(req)) return res.status(403).json({success:false,message:'WO bukan bagian dari bengkel Anda.'});
    next();
});
app.use('/api/vendor-produksi/:woId', (req,res,next) => {
    const id=Number(req.params.woId); const row=db.prepare(`SELECT id,workshop_id FROM wo WHERE id=? LIMIT 1`).get(id);
    if(!row) return res.status(404).json({success:false,message:'WO tidak ditemukan.'});
    if(currentRoleCode(req)!=='SUPER ADMIN' && Number(row.workshop_id||0)!==requestWorkshopId(req)) return res.status(403).json({success:false,message:'WO bukan bagian dari bengkel Anda.'});
    next();
});
app.use('/api/pemakaian-bahan/:woId', (req,res,next) => {
    const id=Number(req.params.woId); const row=db.prepare(`SELECT id,workshop_id FROM wo WHERE id=? LIMIT 1`).get(id);
    if(!row) return res.status(404).json({success:false,message:'WO tidak ditemukan.'});
    if(currentRoleCode(req)!=='SUPER ADMIN' && Number(row.workshop_id||0)!==requestWorkshopId(req)) return res.status(403).json({success:false,message:'WO bukan bagian dari bengkel Anda.'});
    next();
});
app.use('/api/tagihan-or/:woId', (req,res,next) => {
    const id=Number(req.params.woId); const row=db.prepare(`SELECT id,workshop_id FROM wo WHERE id=? LIMIT 1`).get(id);
    if(!row) return res.status(404).json({success:false,message:'WO tidak ditemukan.'});
    if(currentRoleCode(req)!=='SUPER ADMIN' && Number(row.workshop_id||0)!==requestWorkshopId(req)) return res.status(403).json({success:false,message:'WO bukan bagian dari bengkel Anda.'});
    next();
});


// ============================================================
// STRICT WORKSHOP DATA ISOLATION
// Semua resource berbasis ID harus diverifikasi terhadap bengkel
// dari session sebelum handler route berjalan. Ini mencegah akses
// silang hanya dengan mengganti ID pada URL/API.
// ============================================================
function enforceWorkshopResource(req, res, next) {
    const publicPath = (String(req.path || req.originalUrl || "").split("?")[0] || "").toLowerCase();
    if (["/login", "/status", "/session", "/logout"].includes(publicPath)) return next();
    const role = currentRoleCode(req);
    if (role === "SUPER ADMIN") return next();
    const wid = requestWorkshopId(req);
    if (!wid) return res.status(403).json({ success:false, message:"Bengkel aktif tidak valid." });
    const path = String(req.originalUrl || req.path || "").split("?")[0];
    const num = (v) => Number(v);
    const own = (table, id) => {
        if (!Number.isInteger(id) || id <= 0) return false;
        const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND workshop_id = ? LIMIT 1`).get(id, wid);
        return !!row;
    };
    let ok = true;
    if (/^\/api\/customers\/\d+/.test(path)) {
        ok = own("customers", num(path.match(/^\/api\/customers\/(\d+)/)[1]));
    } else if (/^\/api\/asuransi\/\d+/.test(path)) {
        ok = own("insurers", num(path.match(/^\/api\/asuransi\/(\d+)/)[1]));
    } else if (/^\/api\/estimasi\/\d+/.test(path)) {
        ok = own("estimates", num(path.match(/^\/api\/estimasi\/(\d+)/)[1]));
    } else if (/^\/api\/wo\/\d+/.test(path)) {
        ok = own("wo", num(path.match(/^\/api\/wo\/(\d+)/)[1]));
    } else if (/^\/api\/tagihan-kuitansi\/\d+/.test(path)) {
        ok = own("wo", num(path.match(/^\/api\/tagihan-kuitansi\/(\d+)/)[1]));
    } else if (/^\/api\/tagihan-or\/\d+/.test(path)) {
        ok = own("wo", num(path.match(/^\/api\/tagihan-or\/(\d+)/)[1]));
    } else if (/^\/api\/pemakaian-bahan\/\d+/.test(path)) {
        ok = own("wo", num(path.match(/^\/api\/pemakaian-bahan\/(\d+)/)[1]));
    } else if (/^\/api\/vendor-produksi\/\d+/.test(path)) {
        ok = own("wo", num(path.match(/^\/api\/vendor-produksi\/(\d+)/)[1]));
    } else if (/^\/api\/mobil-masuk\/\d+/.test(path)) {
        ok = own("mobil_masuk", num(path.match(/^\/api\/mobil-masuk\/(\d+)/)[1]));
    } else if (/^\/api\/stok-sparepart\/barang-masuk\/\d+/.test(path)) {
        ok = own("sparepart_stock_in", num(path.match(/^\/api\/stok-sparepart\/barang-masuk\/(\d+)/)[1]));
    } else if (/^\/api\/stok-sparepart\/barang-keluar\/\d+/.test(path)) {
        ok = own("sparepart_stock_out", num(path.match(/^\/api\/stok-sparepart\/barang-keluar\/(\d+)/)[1]));
    } else if (/^\/api\/users\/\d+/.test(path)) {
        ok = own("users", num(path.match(/^\/api\/users\/(\d+)/)[1]));
    } else if (/^\/api\/document-history\/TAGIHAN_KUITANSI\/\d+/.test(path)) {
        ok = own("tagihan_kuitansi", num(path.match(/^\/api\/document-history\/TAGIHAN_KUITANSI\/(\d+)/)[1]));
    }
    if (!ok) return res.status(403).json({ success:false, message:"Data bukan bagian dari bengkel Anda." });
    next();
}

// Guard ID resource sebelum seluruh route API diproses.
app.use("/api", enforceWorkshopResource);

// ============================================================
// BACKEND ROLE AUTHORIZATION
// Hak akses utama ditentukan di server, bukan berdasarkan
// localStorage atau header dari browser.
// ============================================================
function normalizeRole(value) {
    return String(value || "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function currentRoleCode(req) {
    return normalizeRole(req.user?.role_code || req.user?.role_name);
}

function requireOperationalAccess(req, res, next) {
    const pathName = (String(req.originalUrl || req.path || "").split("?")[0].replace(/^\/api/i, "") || "/").toLowerCase();
    const method = String(req.method || "GET").toUpperCase();
    const role = currentRoleCode(req);
    if (role === "SUPER ADMIN") return next();
    if (role === "MANAGER MASTER") return next();

    if (pathName === "/users" || pathName === "/roles" || pathName.startsWith("/users/")) {
        return res.status(403).json({ success:false, message:"Akses User & Role hanya untuk Manager Master atau Super Admin." });
    }

    const serviceAdvisor = ["/customers", "/asuransi", "/mobil-masuk", "/estimasi", "/estimasi-selesai", "/wo", "/vendor-produksi"];
    if (serviceAdvisor.some(prefix => pathName === prefix || pathName.startsWith(prefix + "/"))) {
        if (role === "SERVICE ADVISOR") return next();
        if (method === "GET" && (role === "BILLING" || role === "SPAREPART GUDANG")) return next();
        return res.status(403).json({ success:false, message:"Role Anda tidak memiliki izin untuk modul ini." });
    }

    const billing = ["/tagihan-or", "/tagihan-kuitansi", "/pembayaran", "/pemakaian-bahan", "/laporan"];
    if (billing.some(prefix => pathName === prefix || pathName.startsWith(prefix + "/"))) {
        if (role === "BILLING") return next();
        return res.status(403).json({ success:false, message:"Role Anda tidak memiliki izin untuk modul Billing/Laporan." });
    }

    const sparepart = ["/stok-sparepart", "/permintaan-sparepart", "/penerimaan-sparepart-supply"];
    if (sparepart.some(prefix => pathName === prefix || pathName.startsWith(prefix + "/"))) {
        if (role === "SPAREPART GUDANG") return next();
        return res.status(403).json({ success:false, message:"Role Anda tidak memiliki izin untuk modul Sparepart/Gudang." });
    }

    // Central Storage dipakai bersama oleh Permintaan Sparepart dan
    // Penerimaan Sparepart Supply. Manager Master harus dapat membaca/menulis
    // data pusat yang sama seperti Sparepart/Gudang.
    if (pathName.startsWith("/storage/")) {
        if (role === "MANAGER MASTER" || role === "SPAREPART GUDANG" || role === "SERVICE ADVISOR") return next();
        return res.status(403).json({ success:false, message:"Anda tidak memiliki izin untuk data pusat ini." });
    }

    return next();
}

app.use("/api", (req, res, next) => {
    const publicPath = (String(req.originalUrl || req.path || "").split("?")[0].replace(/^\/api/i, "") || "/").toLowerCase();
    if (["/login", "/status", "/session", "/logout"].includes(publicPath)) return next();
    return requireOperationalAccess(req, res, next);
});

// Untuk request yang mengubah data, browser modern wajib mengirim Origin.
// Di production Origin harus sama dengan origin yang sudah di-whitelist.
// Ini menjadi lapisan CSRF tambahan di atas cookie SameSite=Lax.
app.use("/api", (req, res, next) => {
    const method = String(req.method || "GET").toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return next();
    const pathname = (String(req.path || "").split("?")[0] || "").toLowerCase();
    if (["/login", "/status", "/session", "/logout"].includes(pathname)) return next();

    const origin = String(req.headers.origin || "").trim();
    if (!origin) {
        // Non-browser clients tidak memiliki Origin. Tetap diizinkan agar API
        // dapat dipakai oleh tooling/server-side, karena autentikasi session
        // tetap wajib untuk endpoint non-publik.
        return next();
    }
    if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) return next();
    if (process.env.NODE_ENV !== "production" && allowedOrigins.length === 0) return next();
    return res.status(403).json({ success:false, message:"Origin request tidak diizinkan." });
});

// Catat aktivitas perubahan data setelah otorisasi dan CSRF selesai.
app.use("/api", (req, res, next) => {
    const method = String(req.method || "GET").toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return next();
    const pathName = (String(req.path || "").split("?")[0] || "").toLowerCase();
    if (["/login", "/logout", "/session", "/status", "/super-admin/audit-logs"].includes(pathName)) return next();
    const started = Date.now();
    res.on("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
            const action = method === "POST" ? "Membuat / Menjalankan" : method === "DELETE" ? "Menghapus" : "Mengubah";
            const module = auditModuleFromPath(pathName);
            recordAudit(req, action, module, `${method} ${pathName} · HTTP ${res.statusCode} · ${Date.now() - started} ms`);
        }
    });
    next();
});

// Verifikasi password akun yang sedang login. Tidak ada password
// hapus khusus yang di-hard-code di server maupun frontend.
function auditUserId(req) {
    return Number(req?.user?.actor_user_id || req?.user?.user_id || 0) || null;
}

function verifyCurrentUserPassword(req, password) {
    const value = String(password || "").toLowerCase();
    if (!req.user?.user_id || !value) return false;
    const row = db.prepare(`SELECT password_hash, is_active FROM users WHERE id = ? LIMIT 1`).get(req.user.user_id);
    if (!row || !Number(row.is_active) || !row.password_hash) return false;
    try { return bcrypt.compareSync(value, row.password_hash); } catch (_) { return false; }
}

// ============================================================
// CENTRAL STORAGE
// Semua data pendukung aplikasi disimpan pada database pusat.
// ============================================================
// ============================================================
// SPAREPART / GUDANG - SNAPSHOT DATA WO TERPUSAT
// Dipakai bersama oleh Permintaan Sparepart dan Penerimaan Supply.
// Aturan tampil/hilang ditentukan frontend berdasarkan Tagihan Kuitansi.
// ============================================================
app.get("/api/sparepart/work-data", (req, res) => {
    try {
        const data = db.prepare(`
            SELECT
                w.id,
                w.wo_number,
                w.estimate_id,
                w.status,
                w.target_date,
                w.check_in_at,
                w.check_out_at,
                w.first_check_out_at,
                e.estimate_number,
                e.estimate_date,
                i.name AS insurer_name,
                i.alias AS insurer_alias,
                i.code AS insurer_code,
                c.customer_code,
                c.name AS customer_name,
                v.plate_number,
                v.brand,
                v.model,
                v.year,
                v.color,
                v.vin_number,
                v.engine_number
            FROM wo w
            LEFT JOIN estimates e ON e.id = w.estimate_id
            LEFT JOIN customers c ON c.id = e.customer_id AND c.workshop_id = w.workshop_id
            LEFT JOIN vehicles v ON v.id = e.vehicle_id AND v.workshop_id = w.workshop_id
            LEFT JOIN insurers i ON i.id = e.insurer_id AND i.workshop_id = w.workshop_id
            WHERE w.workshop_id = ?
            ORDER BY w.id DESC
        `).all(Number(req.user?.workshop_id||0));

        const sparepartStmt = db.prepare(`
            SELECT
                id,
                estimate_id,
                part_name,
                part_number,
                quantity,
                unit,
                unit_price,
                discount,
                total_price,
                sequence,
                supply_bengkel
            FROM estimate_spareparts
            WHERE estimate_id = ? AND workshop_id = ?
            ORDER BY sequence ASC, id ASC
        `);

        data.forEach(row => {
            row.spareparts = sparepartStmt.all(row.estimate_id, Number(req.user?.workshop_id||0));
        });

        const kuitansi = db.prepare(`
            SELECT
                tk.id AS kuitansi_id, tk.kuitansi_number,
                tk.wo_id,
                tk.grand_total,
                tk.created_at,
                tk.updated_at
            FROM tagihan_kuitansi tk
            WHERE tk.workshop_id = ?
            ORDER BY tk.id DESC
        `).all(Number(req.user?.workshop_id||0));

        const readStorage = (key) => {
            const row = db.prepare(
                `SELECT data_json FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`
            ).get(key, requestWorkshopId(req));
            if (!row || !row.data_json) return [];
            try {
                const parsed = JSON.parse(row.data_json);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                return [];
            }
        };

        res.json({
            success: true,
            data,
            kuitansi,
            purchase_orders: readStorage("purchase_orders"),
            supply_arrivals: readStorage("supply_arrivals")
        });
    } catch (error) {
        console.error("GET SPAREPART WORK DATA ERROR:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Gagal mengambil data Sparepart/Gudang."
        });
    }
});

app.get("/api/storage/:key", (req, res) => {
    try {
        const key = String(req.params.key || "").trim();
        if (!key) return res.status(400).json({ success:false, message:"Storage key wajib diisi." });
        const row = db.prepare(`SELECT storage_key, data_json, updated_by, created_at, updated_at FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`).get(key, requestWorkshopId(req));
        if (!row) return res.json({ success:true, data:null });
        let data = null;
        try { data = JSON.parse(row.data_json); } catch (_) { data = null; }
        res.json({ success:true, data, meta:{updated_by:row.updated_by, created_at:row.created_at, updated_at:row.updated_at} });
    } catch (error) {
        console.error("GET CENTRAL STORAGE ERROR:", error);
        res.status(500).json({ success:false, message:"Gagal mengambil data penyimpanan pusat." });
    }
});

app.put("/api/storage/:key", (req, res) => {
    try {
        const key = String(req.params.key || "").trim();
        if (!key) return res.status(400).json({ success:false, message:"Storage key wajib diisi." });
        const data = req.body?.data;
        if (data === undefined) return res.status(400).json({ success:false, message:"Data wajib diisi." });
        const userId = auditUserId(req);
        const json = JSON.stringify(data);
        storageWrite(req, key, json, userId);
        const row = db.prepare(`SELECT storage_key, data_json, updated_by, created_at, updated_at FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`).get(key, requestWorkshopId(req));
        res.json({ success:true, data: JSON.parse(row.data_json), meta:{updated_by:row.updated_by, created_at:row.created_at, updated_at:row.updated_at} });
    } catch (error) {
        console.error("PUT CENTRAL STORAGE ERROR:", error);
        res.status(500).json({ success:false, message:"Gagal menyimpan data ke database pusat." });
    }
});

app.delete("/api/storage/:key", (req, res) => {
    try {
        const key = String(req.params.key || "").trim();
        if (!key) return res.status(400).json({ success:false, message:"Storage key wajib diisi." });
        db.prepare(`DELETE FROM app_storage WHERE storage_key = ? AND workshop_id = ?`).run(key, requestWorkshopId(req));
        res.json({ success:true });
    } catch (error) {
        console.error("DELETE CENTRAL STORAGE ERROR:", error);
        res.status(500).json({ success:false, message:"Gagal menghapus data dari database pusat." });
    }
});

// ============================================================
// LOGIN
// ============================================================

app.post(
    "/api/login",
    loginRateLimit,
    (req, res) => {

        try {

            const username =
                teks(
                    req.body.username
                );

            const password =
                teks(
                    req.body.password
                );

            // Login username dan password tidak membedakan huruf besar/kecil.
            const normalizedUsername = username.toLowerCase();
            const normalizedPassword = password.toLowerCase();


            if (
                !username ||
                !password
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "Username dan password wajib diisi."

                    });
            }


            const user =
                db.prepare(`
                    SELECT

                        users.id,

                        users.username,

                        users.password_hash,

                        users.full_name,

                        users.is_active,

                        users.workshop_id,

                        workshops.workshop_code,

                        workshops.name AS workshop_name,

                        roles.id AS role_id,

                        roles.code AS role_code,

                        roles.name AS role_name

                    FROM users

                    INNER JOIN roles
                        ON users.role_id =
                           roles.id
                    LEFT JOIN workshops
                        ON workshops.id = users.workshop_id

                    WHERE
                        LOWER(users.username) = LOWER(?)

                    LIMIT 1
                `).get(
                    normalizedUsername
                );


            if (!user) {

                return res
                    .status(401)
                    .json({

                        success: false,

                        message:
                            "Username atau password salah."

                    });
            }


            if (
                !user.is_active
            ) {

                return res
                    .status(403)
                    .json({

                        success: false,

                        message:
                            "User tidak aktif."

                    });
            }


            let valid =
                bcrypt.compareSync(
                    normalizedPassword,
                    user.password_hash
                );

            // Kompatibilitas akun lama: jika password lama masih tersimpan
            // dengan kapitalisasi sebelumnya, izinkan login normal sekali lalu
            // simpan ulang hash dari password yang sudah dinormalisasi.
            if (!valid && password !== normalizedPassword) {
                valid = bcrypt.compareSync(
                    password,
                    user.password_hash
                );
                if (valid) {
                    db.prepare(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
                      .run(bcrypt.hashSync(normalizedPassword, 10), user.id);
                }
            }


            if (!valid) {

                return res
                    .status(401)
                    .json({

                        success: false,

                        message:
                            "Username atau password salah."

                    });
            }


            const session = createSession(user.id);
            setSessionCookie(res, session.token, session.expiresAt);
            clearLoginRateLimit(req);

            res.json({

                success: true,

                message:
                    "Login berhasil.",

                user: {

                    id:
                        user.id,

                    username:
                        user.username,

                    full_name:
                        user.full_name,

                    role: {

                        id:
                            user.role_id,

                        code:
                            user.role_code,

                        name:
                            user.role_name
                    }
                }
            });

        }

        catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Terjadi kesalahan pada server."

                });
        }
    }
);


// ============================================================
// SESSION CHECK / LOGOUT
// ============================================================
app.get("/api/session", requireAuth, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.user_id,
            username: req.user.username,
            full_name: req.user.full_name,
            workshop_id: req.user.workshop_id,
            workshop_name: req.user.workshop_name || null,
            actor_user_id: req.user.actor_user_id || req.user.user_id,
            acting_as: req.user.actor_user_id && Number(req.user.actor_user_id) !== Number(req.user.user_id),
            role: {
                id: req.user.role_id,
                code: req.user.role_code,
                name: req.user.role_name
            }
        }
    });
});

// SUPER ADMIN - GANTI PASSWORD PROFIL
// Password akun Super Admin diubah oleh pemilik akun setelah
// memverifikasi password saat ini. Tidak mengubah akun/bengkel lain.
app.put("/api/super-admin/profile/password", requireAuth, (req, res) => {
    try {
        if (currentRoleCode(req) !== "SUPER ADMIN") {
            return res.status(403).json({ success:false, message:"Akses hanya untuk Super Admin." });
        }

        const currentPassword = String(req.body?.current_password || "").toLowerCase();
        const newPassword = String(req.body?.new_password || "").toLowerCase();

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success:false, message:"Password saat ini dan password baru wajib diisi." });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success:false, message:"Password baru minimal 6 karakter." });
        }
        if (!verifyCurrentUserPassword(req, currentPassword)) {
            return res.status(401).json({ success:false, message:"Password saat ini salah." });
        }
        if (currentPassword === newPassword) {
            return res.status(400).json({ success:false, message:"Password baru harus berbeda dari password saat ini." });
        }

        const result = db.prepare(`
            UPDATE users
            SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND is_active = 1
        `).run(bcrypt.hashSync(newPassword, 10), Number(req.user.user_id));

        if (!result.changes) {
            return res.status(404).json({ success:false, message:"Akun Super Admin tidak ditemukan atau tidak aktif." });
        }

        recordAudit(req, "Mengubah", "Super Admin", "Password akun Super Admin berhasil diubah dari menu Profil.");
        return res.json({ success:true, message:"Password Super Admin berhasil diganti." });
    } catch (error) {
        console.error("SUPER ADMIN CHANGE PASSWORD ERROR:", error);
        return res.status(500).json({ success:false, message:"Gagal mengganti password Super Admin." });
    }
});

app.post("/api/logout", (req, res) => {
    try {
        const token = parseCookies(req)[SESSION_COOKIE];
        if (token) {
            db.prepare(`DELETE FROM user_sessions WHERE token_hash = ?`).run(hashSessionToken(token));
        }
        clearSessionCookie(res);
        res.json({ success: true, message: "Logout berhasil." });
    } catch (error) {
        console.error("LOGOUT ERROR:", error);
        clearSessionCookie(res);
        res.status(500).json({ success: false, message: "Gagal logout." });
    }
});

// ============================================================
// USER MANAGEMENT ACCESS
// Hanya Manager Master yang boleh melihat/mengelola User & Role.
// ============================================================
function requireManagerMaster(req, res) {
    const role = currentRoleCode(req);
    if (role !== "MANAGER MASTER" && role !== "SUPER ADMIN") {
        res.status(403).json({ success: false, message: "Akses User & Role hanya untuk Manager Master atau Super Admin." });
        return false;
    }
    return true;
}



// ============================================================
// SUPER ADMIN - AUDIT LOG
// ============================================================
app.get("/api/super-admin/audit-logs", (req, res) => {
    try {
        if (!requireSuperAdmin(req, res)) return;
        const workshopId = Number(req.query?.workshop_id || 0);
        const userId = Number(req.query?.user_id || 0);
        const module = teks(req.query?.module);
        const action = teks(req.query?.action);
        const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.from || "")) ? String(req.query.from) : "";
        const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.to || "")) ? String(req.query.to) : "";
        const map = auditColumnMap();
        const select = (column, alias, fallback="NULL") => column ? `${column} AS ${alias}` : `${fallback} AS ${alias}`;
        let sql = `SELECT
            ${select(map.id,"id")},
            ${select(map.actor,"actor_user_id")},
            ${select(map.workshop,"workshop_id")},
            ${select(map.action,"action","''")},
            ${select(map.module,"module","''")},
            ${select(map.detail,"detail","''")},
            ${select(map.ip,"ip_address","''")},
            ${select(map.userAgent,"user_agent","''")},
            ${select(map.created,"created_at","CURRENT_TIMESTAMP")}
            FROM audit_logs WHERE 1=1`;
        const params=[];
        if (map.workshop && workshopId > 0) { sql += ` AND ${map.workshop} = ?`; params.push(workshopId); }
        if (map.actor && userId > 0) { sql += ` AND ${map.actor} = ?`; params.push(userId); }
        if (map.module && module) { sql += ` AND LOWER(COALESCE(${map.module},'')) = LOWER(?)`; params.push(module); }
        if (map.action && action) { sql += ` AND LOWER(COALESCE(${map.action},'')) LIKE LOWER(?)`; params.push(`%${action}%`); }
        if (map.created && from) { sql += ` AND date(${map.created}) >= date(?)`; params.push(from); }
        if (map.created && to) { sql += ` AND date(${map.created}) <= date(?)`; params.push(to); }
        sql += ` ORDER BY ${map.created || "rowid"} DESC LIMIT 1000`;
        const data = db.prepare(sql).all(...params);
        const enriched = data.map(row => {
            const user = row.actor_user_id ? db.prepare(`SELECT u.id,u.username,u.full_name,u.workshop_id,r.code AS role_code,r.name AS role_name,w.name AS workshop_name FROM users u LEFT JOIN roles r ON r.id=u.role_id LEFT JOIN workshops w ON w.id=u.workshop_id WHERE u.id=? LIMIT 1`).get(row.actor_user_id) : null;
            return {...row, user_full_name:user?.full_name || "Sistem", username:user?.username || "", role_name:user?.role_name || "", workshop_name:user?.workshop_name || ""};
        });
        res.json({success:true,data:enriched});
    } catch(error) {
        console.error("GET AUDIT LOG ERROR:", error);
        res.status(500).json({success:false,message:"Gagal mengambil Audit Log."});
    }
});

// ============================================================
// SUPER ADMIN / MULTI BENGKEL
// ============================================================
// Logo bengkel disimpan sebagai data URL di tabel workshops agar tidak
// membutuhkan folder upload/dependency tambahan dan tetap berjalan di LAN.
try {
    const workshopColumns = db.prepare("PRAGMA table_info(workshops)").all();
    if (!workshopColumns.some(column => column.name === "logo_data")) {
        db.exec(`ALTER TABLE workshops ADD COLUMN logo_data TEXT`);
        console.log("Kolom workshops.logo_data berhasil ditambahkan.");
    }
    if (!workshopColumns.some(column => column.name === "logo_data_square")) {
        db.exec(`ALTER TABLE workshops ADD COLUMN logo_data_square TEXT`);
        console.log("Kolom workshops.logo_data_square berhasil ditambahkan.");
    }
    if (!workshopColumns.some(column => column.name === "email")) {
        db.exec(`ALTER TABLE workshops ADD COLUMN email TEXT`);
        console.log("Kolom workshops.email berhasil ditambahkan.");
    }
    if (!workshopColumns.some(column => column.name === "document_code")) {
        db.exec(`ALTER TABLE workshops ADD COLUMN document_code TEXT`);
        db.prepare(`UPDATE workshops SET document_code = workshop_code WHERE COALESCE(TRIM(document_code), '') = ''`).run();
        console.log("Kolom workshops.document_code berhasil ditambahkan.");
    }
    const kuitansiColumns = db.prepare("PRAGMA table_info(tagihan_kuitansi)").all();
    if (!kuitansiColumns.some(column => column.name === "kuitansi_number")) {
        db.exec(`ALTER TABLE tagihan_kuitansi ADD COLUMN kuitansi_number TEXT`);
        console.log("Kolom tagihan_kuitansi.kuitansi_number berhasil ditambahkan.");
    }
} catch (error) {
    console.error("MIGRASI LOGO BENGKEL ERROR:", error);
}

function requireSuperAdmin(req, res) {
    if (currentRoleCode(req) !== "SUPER ADMIN") {
        res.status(403).json({ success:false, message:"Akses hanya untuk Super Admin." });
        return false;
    }
    return true;
}

function validWorkshopLogo(value) {
    const logo = String(value || "").trim();
    if (!logo) return null;
    // Hanya izinkan format gambar yang umum dan ukuran data URL <= 1 MB.
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) {
        throw new Error("Logo harus berupa PNG, JPG/JPEG, atau WebP yang valid.");
    }
    const base64 = logo.slice(logo.indexOf(",") + 1);
    if (Buffer.byteLength(base64, "base64") > 1024 * 1024) {
        throw new Error("Ukuran logo maksimal 1 MB.");
    }
    return logo;
}

function generateWorkshopCode() {
    const row = db.prepare(`SELECT workshop_code FROM workshops ORDER BY id DESC LIMIT 1`).get();
    const n = Number(String(row?.workshop_code || "").match(/(\d+)$/)?.[1] || 0) + 1;
    return `BKL-${String(n).padStart(4,"0")}`;
}

function workshopDocumentCode(workshopId) {
    const id = Number(workshopId || 0);
    if (!idValid(id)) return "BKL";
    const row = db.prepare(`SELECT document_code, workshop_code FROM workshops WHERE id = ? LIMIT 1`).get(id);
    const code = String(row?.document_code || row?.workshop_code || "BKL").trim().toUpperCase();
    return code || "BKL";
}

function validDocumentCode(value) {
    const code = String(value || "").trim().toUpperCase();
    if (!code) return null;
    if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) throw new Error("Kode Identitas Dokumen hanya boleh berisi huruf, angka, garis bawah, atau tanda hubung (maksimal 20 karakter).");
    return code;
}
function ensureUniqueDocumentCode(code, excludeId = 0) {
    if (!code) return;
    const row = db.prepare(`SELECT id FROM workshops WHERE UPPER(TRIM(document_code)) = UPPER(TRIM(?)) AND id <> ? LIMIT 1`).get(code, Number(excludeId) || 0);
    if (row) throw new Error(`Kode Identitas Dokumen "${code}" sudah digunakan oleh bengkel lain.`);
}

function generateKuitansiNumber(workshopId, kuitansiId) {
    return buildDocumentNumber(workshopId, "KUITANSI", new Date());
}

app.get("/api/workshop/current", (req,res) => {
    try {
        const workshopId=Number(req.user?.workshop_id||0);
        if(!workshopId) return res.json({success:true,data:null});
        const data=db.prepare(`SELECT id,workshop_code,document_code,name,address,phone,email,notes,logo_data,logo_data_square,is_active FROM workshops WHERE id=? LIMIT 1`).get(workshopId);
        if(!data) return res.status(404).json({success:false,message:"Bengkel tidak ditemukan."});
        res.json({success:true,data});
    } catch(error) { console.error("GET CURRENT WORKSHOP ERROR:",error); res.status(500).json({success:false,message:"Gagal mengambil identitas bengkel."}); }
});

// ============================================================
// SUPER ADMIN - MONITORING TERPUSAT
// Hanya membaca data. Tidak mengubah transaksi atau setting bengkel.
// ============================================================
app.get("/api/super-admin/monitoring", (req, res) => {
    try {
        if (!requireSuperAdmin(req, res)) return;

        const requestedWorkshopId = Number(req.query?.workshop_id || 0);
        const workshops = db.prepare(`
            SELECT id, workshop_code, document_code, name, address, is_active, created_at
            FROM workshops ORDER BY id ASC
        `).all();
        const selectedIds = requestedWorkshopId > 0
            ? workshops.filter(w => Number(w.id) === requestedWorkshopId).map(w => Number(w.id))
            : workshops.map(w => Number(w.id));
        if (requestedWorkshopId > 0 && !selectedIds.length) {
            return res.status(404).json({ success:false, message:"Bengkel tidak ditemukan." });
        }

        const inClause = ids => ids.length ? ids.map(() => "?").join(",") : "NULL";
        const hasTable = name => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`).get(name);
        const hasCol = (table, col) => hasTable(table) && db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().some(x => x.name === col);
        const count = (table, where = "1=1", params = []) => {
            if (!hasTable(table) || !hasCol(table, "workshop_id") || !selectedIds.length) return 0;
            try {
                return Number(db.prepare(`SELECT COUNT(*) n FROM ${quoteIdent(table)} WHERE workshop_id IN (${inClause(selectedIds)}) AND (${where})`).get(...selectedIds, ...params)?.n || 0);
            } catch (_) { return 0; }
        };
        const countWorkshop = (table, workshopId, where = "1=1", params = []) => {
            if (!hasTable(table) || !hasCol(table, "workshop_id")) return 0;
            try {
                return Number(db.prepare(`SELECT COUNT(*) n FROM ${quoteIdent(table)} WHERE workshop_id=? AND (${where})`).get(workshopId, ...params)?.n || 0);
            } catch (_) { return 0; }
        };

        const users = hasTable("users") ? db.prepare(`
            SELECT u.id,u.workshop_id,u.full_name,u.username,u.is_active,
                   r.code AS role_code,r.name AS role_name
            FROM users u LEFT JOIN roles r ON r.id=u.role_id
            WHERE u.workshop_id IN (${inClause(selectedIds)})
              AND UPPER(COALESCE(r.code,'')) <> 'SUPER_ADMIN'
            ORDER BY u.id ASC
        `).all(...selectedIds) : [];
        const normalizeRole = value => String(value || "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
        const roleRows = role => users.filter(u => normalizeRole(u.role_code) === role || normalizeRole(u.role_name) === role);

        // Estimasi aktif mengikuti definisi aplikasi: semua estimasi yang masih ada.
        // WO aktif: belum CHECK OUT.
        const woCheckout = `UPPER(TRIM(COALESCE(status,''))) IN ('CHECK OUT','CHECKOUT','SELESAI') OR check_out_at IS NOT NULL`;
        const woActive = `NOT (${woCheckout})`;

        const workshopStats = selectedIds.map(id => {
            const w = workshops.find(x => Number(x.id) === id) || {};
            const wu = users.filter(u => Number(u.workshop_id) === id);
            return {
                id,
                workshop_code: w.workshop_code || "",
                document_code: w.document_code || w.workshop_code || "",
                name: w.name || "-",
                is_active: Number(w.is_active) !== 0 ? 1 : 0,
                users: wu.length,
                active_users: wu.filter(u => Number(u.is_active) !== 0).length,
                managers: wu.filter(u => normalizeRole(u.role_code) === "MANAGER MASTER" || normalizeRole(u.role_name) === "MANAGER MASTER").length,
                estimates: countWorkshop("estimates", id),
                wo_active: countWorkshop("wo", id, woActive),
                wo_checkout: countWorkshop("wo", id, woCheckout),
                tagihan: countWorkshop("tagihan_kuitansi", id),
                pembayaran: countWorkshop("pembayaran_kuitansi", id),
                produksi: countWorkshop("production_worker_prices", id),
                pemakaian_bahan: countWorkshop("material_usage", id),
                sparepart_stock_in: countWorkshop("sparepart_stock_in", id),
                sparepart_stock_out: countWorkshop("sparepart_stock_out", id),
                permintaan_sparepart: countWorkshop("permintaan_sparepart", id),
                penerimaan_sparepart: countWorkshop("penerimaan_sparepart", id),
                sparepart_supply: countWorkshop("sparepart_supply", id)
            };
        });

        const totals = {
            workshops: selectedIds.length,
            active_workshops: workshops.filter(w => selectedIds.includes(Number(w.id)) && Number(w.is_active) !== 0).length,
            users: users.length,
            active_users: users.filter(u => Number(u.is_active) !== 0).length,
            estimates: count("estimates"),
            wo_active: count("wo", woActive),
            wo_checkout: count("wo", woCheckout),
            tagihan: count("tagihan_kuitansi"),
            pembayaran: count("pembayaran_kuitansi"),
            produksi: count("production_worker_prices"),
            pemakaian_bahan: count("material_usage"),
            sparepart_stock_in: count("sparepart_stock_in"),
            sparepart_stock_out: count("sparepart_stock_out"),
            permintaan_sparepart: count("permintaan_sparepart"),
            penerimaan_sparepart: count("penerimaan_sparepart"),
            sparepart_supply: count("sparepart_supply")
        };

        const alerts = [];
        const addAlert = (type,severity,title,detail,n,workshopId=null,workshopName=null) => {
            if (Number(n || 0) > 0) alerts.push({type,severity,title,detail,count:Number(n),workshop_id:workshopId,workshop_name:workshopName});
        };
        if (hasTable("wo") && hasCol("wo","created_at")) {
            addAlert("AGING_WO","warning","WO aktif lebih dari 14 hari","WO masih aktif dan tanggal pembuatannya sudah lebih dari 14 hari.",count("wo",`${woActive} AND datetime(created_at) < datetime('now','-14 days')`));
        }
        if (hasTable("wo") && hasTable("tagihan_kuitansi")) {
            try {
                const n = Number(db.prepare(`SELECT COUNT(*) n FROM wo w WHERE w.workshop_id IN (${inClause(selectedIds)}) AND (${woCheckout}) AND NOT EXISTS (SELECT 1 FROM tagihan_kuitansi tk WHERE tk.wo_id=w.id AND tk.workshop_id=w.workshop_id)`).get(...selectedIds)?.n || 0);
                addAlert("CHECKOUT_NO_BILL","critical","WO CHECK OUT belum dibuatkan Tagihan Kuitansi","WO sudah CHECK OUT tetapi belum memiliki Tagihan Kuitansi.",n);
            } catch (_) {}
        }
        if (hasTable("tagihan_kuitansi") && hasTable("pembayaran_kuitansi")) {
            try {
                const n = Number(db.prepare(`SELECT COUNT(*) n FROM tagihan_kuitansi tk WHERE tk.workshop_id IN (${inClause(selectedIds)}) AND NOT EXISTS (SELECT 1 FROM pembayaran_kuitansi pk WHERE pk.wo_id=tk.wo_id AND pk.workshop_id=tk.workshop_id)`).get(...selectedIds)?.n || 0);
                addAlert("BILL_NO_PAYMENT","info","Tagihan Kuitansi belum memiliki pembayaran","Tagihan sudah dibuat tetapi belum ada data pembayaran.",n);
            } catch (_) {}
        }

        const recentActivity = [];
        if (hasTable("audit_logs")) {
            try {
                const rows = db.prepare(`
                    SELECT a.id,a.action,a.module,a.detail,a.created_at,a.workshop_id,
                           u.full_name AS user_full_name,u.username,w.name AS workshop_name
                    FROM audit_logs a
                    LEFT JOIN users u ON u.id=a.actor_user_id
                    LEFT JOIN workshops w ON w.id=a.workshop_id
                    WHERE (a.workshop_id IN (${inClause(selectedIds)}) OR a.workshop_id IS NULL)
                    ORDER BY a.id DESC LIMIT 25
                `).all(...selectedIds);
                rows.forEach(r => recentActivity.push(r));
            } catch (_) {}
        }

        res.json({
            success:true,
            generated_at:new Date().toISOString(),
            filter:{workshop_id:requestedWorkshopId || null},
            totals,
            roles:{
                manager_master:roleRows("MANAGER MASTER").length,
                service_advisor:roleRows("SERVICE ADVISOR").length,
                billing:roleRows("BILLING").length,
                sparepart_gudang:roleRows("SPAREPART GUDANG").length
            },
            workshops:workshopStats,
            alerts:alerts.sort((a,b)=>({critical:0,warning:1,info:2}[a.severity]??9)-({critical:0,warning:1,info:2}[b.severity]??9)),
            recent_activity:recentActivity
        });
    } catch (error) {
        console.error("SUPER ADMIN MONITORING ERROR:", error);
        res.status(500).json({success:false,message:`Gagal mengambil data monitoring Super Admin: ${error.message}`});
    }
});

function quoteIdent(name) {
    return '"' + String(name || "").replace(/"/g, '""') + '"';
}


app.get("/api/super-admin/workshops", (req,res) => {
    try {
        if (!requireSuperAdmin(req,res)) return;
        const data = db.prepare(`SELECT id,workshop_code,document_code,name,address,phone,email,notes,logo_data,logo_data_square,is_active,created_at,updated_at FROM workshops ORDER BY id ASC`).all();
        res.json({success:true,data});
    } catch(error) { console.error(error); res.status(500).json({success:false,message:"Gagal mengambil data bengkel."}); }
});

app.post("/api/super-admin/workshops", (req,res) => {
    try {
        if (!requireSuperAdmin(req,res)) return;
        const name = teks(req.body?.name);
        if (!name) return res.status(400).json({success:false,message:"Nama bengkel wajib diisi."});
        const code = generateWorkshopCode();
        const documentCode = validDocumentCode(req.body?.document_code) || code;
        ensureUniqueDocumentCode(documentCode);
        const result = db.prepare(`INSERT INTO workshops (workshop_code,document_code,name,address,phone,email,notes,logo_data,logo_data_square) VALUES (?,?,?,?,?,?,?,?,?)`).run(code,documentCode,name,teks(req.body?.address)||null,teks(req.body?.phone)||null,teks(req.body?.email)||null,teks(req.body?.notes)||null,validWorkshopLogo(req.body?.logo_data),validWorkshopLogo(req.body?.logo_data_square));
        const managerUsername = teks(req.body?.manager_username);
        const managerPassword = String(req.body?.manager_password || "");
        const managerName = teks(req.body?.manager_full_name) || "Manager Master";
        let manager = null;
        if (managerUsername || managerPassword) {
            if (!managerUsername || managerPassword.length < 6) return res.status(400).json({success:false,message:"Username Manager Master dan password minimal 6 karakter wajib diisi."});
            const role = db.prepare(`SELECT id FROM roles WHERE code='MANAGER_MASTER' LIMIT 1`).get();
            if (!role) throw new Error("Role Manager Master belum tersedia.");
            const dup = db.prepare(`SELECT id FROM users WHERE LOWER(username)=LOWER(?)`).get(managerUsername);
            if (dup) return res.status(409).json({success:false,message:"Username Manager Master sudah digunakan."});
            const u = db.prepare(`INSERT INTO users (username,password_hash,full_name,role_id,is_active,workshop_id) VALUES (?,?,?,?,1,?)`).run(managerUsername,bcrypt.hashSync(managerPassword.toLowerCase(),10),managerName,role.id,result.lastInsertRowid);
            manager = {id:u.lastInsertRowid,username:managerUsername,full_name:managerName};
        }
        const workshop = db.prepare(`SELECT * FROM workshops WHERE id=?`).get(result.lastInsertRowid);
        res.status(201).json({success:true,message:"Bengkel berhasil dibuat.",data:{workshop,manager}});
    } catch(error) { console.error("CREATE WORKSHOP ERROR:",error); res.status(500).json({success:false,message:error.message||"Gagal membuat bengkel."}); }
});

app.patch("/api/super-admin/workshops/:id", (req,res) => {
    try {
        if (!requireSuperAdmin(req,res)) return;
        const id=Number(req.params.id); if(!idValid(id)) return res.status(400).json({success:false,message:"ID bengkel tidak valid."});
        const current=db.prepare(`SELECT * FROM workshops WHERE id=?`).get(id); if(!current) return res.status(404).json({success:false,message:"Bengkel tidak ditemukan."});
        const documentCode = validDocumentCode(req.body?.document_code===undefined ? current.document_code : req.body?.document_code) || current.workshop_code;
        ensureUniqueDocumentCode(documentCode, id);
        const logoData = req.body?.logo_data === undefined ? current.logo_data : validWorkshopLogo(req.body?.logo_data);
        const logoDataSquare = req.body?.logo_data_square === undefined ? current.logo_data_square : validWorkshopLogo(req.body?.logo_data_square);
        db.prepare(`UPDATE workshops SET document_code=?,name=?,address=?,phone=?,email=?,notes=?,logo_data=?,logo_data_square=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(documentCode,teks(req.body?.name)||current.name,teks(req.body?.address)||null,teks(req.body?.phone)||null,req.body?.email===undefined?current.email||null:teks(req.body?.email)||null,teks(req.body?.notes)||null,logoData,logoDataSquare,req.body?.is_active===undefined?current.is_active:(Number(req.body.is_active)?1:0),id);
        res.json({success:true,data:db.prepare(`SELECT * FROM workshops WHERE id=?`).get(id)});
    } catch(error) { console.error(error); res.status(500).json({success:false,message:"Gagal memperbarui bengkel."}); }
});

app.post("/api/super-admin/return", (req,res) => {
    try {
        const actorId = Number(req.user?.actor_user_id || 0);
        if (!actorId || actorId === Number(req.user?.user_id || 0)) {
            return res.status(400).json({success:false,message:"Sesi saat ini bukan mode Masuk sebagai Bengkel."});
        }
        const actor = db.prepare(`SELECT u.id,u.username,u.full_name,u.workshop_id,r.id role_id,r.code role_code,r.name role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND r.code='SUPER_ADMIN' AND u.is_active=1 LIMIT 1`).get(actorId);
        if (!actor) return res.status(403).json({success:false,message:"Sesi Super Admin asal tidak ditemukan."});
        const token = parseCookies(req)[SESSION_COOKIE];
        if (token) db.prepare(`DELETE FROM user_sessions WHERE token_hash=?`).run(hashSessionToken(token));
        const session=createSession(actor.id);
        setSessionCookie(res,session.token,session.expiresAt);
        recordAudit({user:{user_id:actor.id,actor_user_id:actor.id,workshop_id:null},headers:req.headers,ip:req.ip},"KEMBALI KE SUPER ADMIN","Data Bengkel",`Kembali dari mode bengkel oleh Super Admin ${actor.username}`);
        res.json({success:true,message:"Berhasil kembali ke Super Admin.",user:{id:actor.id,username:actor.username,full_name:actor.full_name,workshop_id:actor.workshop_id,acting_as:false,role:{id:actor.role_id,code:actor.role_code,name:actor.role_name}}});
    } catch(error) { console.error(error); res.status(500).json({success:false,message:"Gagal kembali ke Super Admin."}); }
});

app.post("/api/super-admin/impersonate", (req,res) => {
    try {
        if (!requireSuperAdmin(req,res)) return;
        const workshopId=Number(req.body?.workshop_id); if(!idValid(workshopId)) return res.status(400).json({success:false,message:"Bengkel tidak valid."});
        const manager=db.prepare(`SELECT u.id,u.username,u.full_name,u.workshop_id,r.id role_id,r.code role_code,r.name role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.workshop_id=? AND r.code='MANAGER_MASTER' AND u.is_active=1 ORDER BY u.id LIMIT 1`).get(workshopId);
        if(!manager) return res.status(404).json({success:false,message:"Manager Master bengkel belum tersedia."});
        const session=createSession(manager.id, req.user.user_id); setSessionCookie(res,session.token,session.expiresAt);
        res.json({success:true,message:"Berhasil masuk sebagai Manager Master bengkel.",user:{id:manager.id,username:manager.username,full_name:manager.full_name,workshop_id:manager.workshop_id,role:{id:manager.role_id,code:manager.role_code,name:manager.role_name}}});
    } catch(error) { console.error(error); res.status(500).json({success:false,message:"Gagal masuk sebagai bengkel."}); }
});

const SYSTEM_SETTINGS_KEY = "super_admin_system_settings";
const DEFAULT_SYSTEM_SETTINGS = {
    app_name: "MyWorkshop",
    app_version: "1.0.0",
    multi_workshop_enabled: true,
    new_workshop_active: true,
    password_min_length: 6,
    session_duration_hours: 8
};

const SYSTEM_SETTINGS_WORKSHOP_ID = 0;

function getSystemSettings() {
    const row = db.prepare(`SELECT data_json, updated_at FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`).get(SYSTEM_SETTINGS_KEY, SYSTEM_SETTINGS_WORKSHOP_ID);
    if (!row?.data_json) return { ...DEFAULT_SYSTEM_SETTINGS, updated_at: null };
    try {
        const saved = JSON.parse(row.data_json);
        return { ...DEFAULT_SYSTEM_SETTINGS, ...saved, updated_at: row.updated_at || saved.updated_at || null };
    } catch (_) {
        return { ...DEFAULT_SYSTEM_SETTINGS, updated_at: row.updated_at || null };
    }
}

app.get("/api/super-admin/system-settings", (req, res) => {
    try {
        if (!requireSuperAdmin(req, res)) return;
        res.json({ success:true, data:getSystemSettings() });
    } catch (error) {
        console.error("GET SYSTEM SETTINGS ERROR:", error);
        res.status(500).json({ success:false, message:"Gagal mengambil Pengaturan Sistem." });
    }
});

app.put("/api/super-admin/system-settings", (req, res) => {
    try {
        if (!requireSuperAdmin(req, res)) return;
        const current = getSystemSettings();
        const minPassword = Math.max(6, Math.min(128, Number(req.body?.password_min_length || current.password_min_length)));
        const sessionHours = Math.max(1, Math.min(168, Number(req.body?.session_duration_hours || current.session_duration_hours)));
        const data = {
            app_name: teks(req.body?.app_name) || current.app_name || "MyWorkshop",
            app_version: teks(req.body?.app_version) || current.app_version || "1.0.0",
            multi_workshop_enabled: req.body?.multi_workshop_enabled === undefined ? !!current.multi_workshop_enabled : !!req.body.multi_workshop_enabled,
            new_workshop_active: req.body?.new_workshop_active === undefined ? !!current.new_workshop_active : !!req.body.new_workshop_active,
            password_min_length: minPassword,
            session_duration_hours: sessionHours
        };
        db.prepare(`INSERT INTO app_storage (storage_key,data_json,updated_by,updated_at,workshop_id) VALUES (?,?,?,CURRENT_TIMESTAMP,?)
            ON CONFLICT(storage_key,workshop_id) DO UPDATE SET data_json=excluded.data_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
            .run(SYSTEM_SETTINGS_KEY, JSON.stringify(data), auditUserId(req), SYSTEM_SETTINGS_WORKSHOP_ID);

        // Durasi sesi adalah kebijakan GLOBAL aplikasi, bukan milik Super Admin
        // atau bengkel tertentu. Saat nilainya diubah, terapkan juga ke seluruh
        // session aktif berdasarkan aktivitas terakhir masing-masing user agar
        // user yang sudah login ikut memakai durasi baru.
        try {
            const activeSessions = db.prepare(`SELECT id,last_seen_at FROM user_sessions`).all();
            const updateSessionExpiry = db.prepare(`UPDATE user_sessions SET expires_at = ? WHERE id = ?`);
            const nowMs = Date.now();
            for (const session of activeSessions) {
                const rawLastSeen = String(session.last_seen_at || '').trim();
                const lastSeenMs = rawLastSeen
                    ? new Date(rawLastSeen.includes('T') ? rawLastSeen : rawLastSeen.replace(' ', 'T') + 'Z').getTime()
                    : NaN;
                const baseMs = Number.isFinite(lastSeenMs) ? lastSeenMs : nowMs;
                updateSessionExpiry.run(
                    new Date(baseMs + sessionHours * 60 * 60 * 1000).toISOString(),
                    session.id
                );
            }
        } catch (sessionError) {
            console.error("UPDATE GLOBAL SESSION DURATION ERROR:", sessionError);
        }

        recordAudit(req, "UBAH PENGATURAN SISTEM", "Pengaturan Sistem", JSON.stringify(data));
        const savedRow = db.prepare(`SELECT updated_at FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`).get(SYSTEM_SETTINGS_KEY, SYSTEM_SETTINGS_WORKSHOP_ID);
        res.json({ success:true, message:"Pengaturan Sistem berhasil disimpan.", data:{...data, updated_at:savedRow?.updated_at || null} });
    } catch (error) {
        console.error("PUT SYSTEM SETTINGS ERROR:", error);
        res.status(500).json({ success:false, message:"Gagal menyimpan Pengaturan Sistem." });
    }
});

// ============================================================
// SUPER ADMIN - PENOMORAN DOKUMEN PER BENGKEL
// ============================================================
app.get("/api/super-admin/document-numbering", (req, res) => {
    try {
        if (!requireSuperAdmin(req, res)) return;
        const workshopId = Number(req.query?.workshop_id || 0);
        if (!idValid(workshopId)) return res.status(400).json({ success:false, message:"Bengkel tidak valid." });
        const workshop = db.prepare(`SELECT id,workshop_code,document_code,name FROM workshops WHERE id=? LIMIT 1`).get(workshopId);
        if (!workshop) return res.status(404).json({ success:false, message:"Bengkel tidak ditemukan." });
        res.json({
            success: true,
            data: {
                workshop_id: workshop.id,
                workshop_name: workshop.name,
                workshop_code: workshop.workshop_code,
                document_identity_code: workshop.document_code || workshop.workshop_code || "BKL",
                ...getDocumentNumberingSettings(workshopId),
                format: "YYMM + Kode Dokumen + Kode Identitas Dokumen + 0001"
            }
        });
    } catch (error) {
        console.error("GET DOCUMENT NUMBERING ERROR:", error);
        res.status(500).json({ success:false, message:error.message || "Gagal mengambil pengaturan penomoran dokumen." });
    }
});

app.put("/api/super-admin/document-numbering", (req, res) => {
    try {
        if (!requireSuperAdmin(req, res)) return;
        const workshopId = Number(req.body?.workshop_id || 0);
        if (!idValid(workshopId)) return res.status(400).json({ success:false, message:"Bengkel tidak valid." });
        const workshop = db.prepare(`SELECT id,name FROM workshops WHERE id=? LIMIT 1`).get(workshopId);
        if (!workshop) return res.status(404).json({ success:false, message:"Bengkel tidak ditemukan." });

        const estimateCode = normalizeDocumentNumberingCode(req.body?.estimate_code, "01");
        const woCode = normalizeDocumentNumberingCode(req.body?.wo_code, "02");
        const kuitansiCode = normalizeDocumentNumberingCode(req.body?.kuitansi_code, "03");
        if (new Set([estimateCode, woCode, kuitansiCode]).size !== 3) {
            return res.status(400).json({ success:false, message:"Kode Estimasi, WO, dan Kuitansi harus berbeda." });
        }

        const data = {
            estimate_code: estimateCode,
            wo_code: woCode,
            kuitansi_code: kuitansiCode,
            number_digits: 4,
            reset_yearly: true
        };
        db.prepare(`INSERT INTO app_storage (storage_key,data_json,updated_by,updated_at,workshop_id) VALUES (?,?,?,CURRENT_TIMESTAMP,?)
            ON CONFLICT(storage_key,workshop_id) DO UPDATE SET data_json=excluded.data_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
            .run(DOCUMENT_NUMBERING_KEY, JSON.stringify(data), auditUserId(req), workshopId);
        recordAudit(req, "UBAH PENOMORAN DOKUMEN", `Penomoran ${workshop.name}`, JSON.stringify(data));
        res.json({ success:true, message:`Penomoran dokumen ${workshop.name} berhasil disimpan.`, data });
    } catch (error) {
        console.error("PUT DOCUMENT NUMBERING ERROR:", error);
        res.status(500).json({ success:false, message:error.message || "Gagal menyimpan pengaturan penomoran dokumen." });
    }
});

app.post("/api/super-admin/database/backup", (req, res) => {
    let backupPath = null;
    try {
        if (!requireSuperAdmin(req, res)) return;

        const backupDir = path.join(__dirname, "../database/backups");
        fs.mkdirSync(backupDir, { recursive: true });

        // Gunakan nama unik agar VACUUM INTO tidak gagal karena file sudah ada.
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const uniquePart = `${process.pid}-${Date.now()}`;
        const filename = `myworkshop-${stamp}-${uniquePart}.db`;
        backupPath = path.join(backupDir, filename);

        db.prepare(`VACUUM INTO ?`).run(backupPath);
        recordAudit(req, "BACKUP DATABASE", "Pengaturan Sistem", `Backup dibuat: ${filename}`);

        return res.download(backupPath, filename, (downloadError) => {
            if (downloadError) {
                console.error("DATABASE BACKUP DOWNLOAD ERROR:", downloadError);
                // Jangan mengirim respons kedua jika header/file sudah mulai dikirim.
                if (!res.headersSent) {
                    res.status(500).json({ success: false, message: "File backup gagal diunduh." });
                }
            }
        });
    } catch (error) {
        console.error("DATABASE BACKUP ERROR:", error);
        if (res.headersSent) return;
        return res.status(500).json({
            success: false,
            message: error.message || "Gagal membuat backup database."
        });
    }
});


// ============================================================
// USERS
// ============================================================

app.get(
    "/api/users",
    (req, res) => {
        try {
            if (!requireManagerMaster(req, res)) return;
            const role = currentRoleCode(req);
            const workshopId = Number(req.query?.workshop_id || 0);
            let sql = `
                SELECT users.id, users.username, users.full_name, users.role_id, users.is_active,
                       users.workshop_id, workshops.workshop_code, workshops.name AS workshop_name,
                       roles.code AS role_code, roles.name AS role_name, users.created_at, users.updated_at
                FROM users
                INNER JOIN roles ON users.role_id = roles.id
                LEFT JOIN workshops ON workshops.id = users.workshop_id
                WHERE UPPER(COALESCE(roles.code,'')) <> 'SUPER_ADMIN'`;
            const params = [];
            if (role === "MANAGER MASTER") {
                sql += ` AND users.workshop_id = ?`;
                params.push(Number(req.user.workshop_id || 0));
            } else if (workshopId > 0) {
                sql += ` AND users.workshop_id = ?`;
                params.push(workshopId);
            }
            sql += ` ORDER BY users.workshop_id ASC, users.id ASC`;
            const users = db.prepare(sql).all(...params);
            res.json({ success:true, data:users });
        } catch (error) {
            console.error("GET USERS ERROR:", error);
            res.status(500).json({ success:false, message:"Gagal mengambil data user." });
        }
    }
);


// ============================================================
// PASSWORD PENGHAPUSAN
// Diatur khusus melalui menu User & Role oleh Manager Master.
// Password disimpan sebagai bcrypt hash di app_storage dan tidak pernah
// dikirim kembali ke browser.
// ============================================================
function getDeletePasswordSettings(req) {
    const row = db.prepare(`SELECT data_json FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`).get("delete_password_settings", requestWorkshopId(req));
    if (!row || !row.data_json) return { estimate_hash: "", wo_hash: "" };
    try {
        const value = JSON.parse(row.data_json);
        return {
            estimate_hash: String(value?.estimate_hash || ""),
            wo_hash: String(value?.wo_hash || "")
        };
    } catch (_) {
        return { estimate_hash: "", wo_hash: "" };
    }
}

function requireDeleteManagerMaster(req, res) {
    // Hanya role efektif Manager Master yang boleh menghapus Estimasi/WO.
    // Saat Super Admin memakai "Masuk sebagai Bengkel", session user adalah
    // Manager Master sehingga tetap diizinkan. actor_user_id tetap menyimpan
    // identitas Super Admin untuk Audit Log.
    if (currentRoleCode(req) !== "MANAGER MASTER") {
        res.status(403).json({
            success: false,
            message: "Hanya Manager Master yang dapat menghapus Estimasi atau WO."
        });
        return false;
    }
    return true;
}

function verifyConfiguredDeletePassword(req, type, password) {
    const settings = getDeletePasswordSettings(req);
    const hash = type === "wo" ? settings.wo_hash : settings.estimate_hash;
    const value = String(password || "");
    if (!hash || !value) return false;
    try { return bcrypt.compareSync(value, hash); } catch (_) { return false; }
}

app.put("/api/security/delete-passwords", (req, res) => {
    try {
        if (!requireManagerMaster(req, res)) return;

        const estimatePassword = String(req.body?.estimate_password || "");
        const woPassword = String(req.body?.wo_password || "");
        if (estimatePassword.length < 6 || woPassword.length < 6) {
            return res.status(400).json({ success:false, message:"Password Hapus Estimasi dan Hapus WO minimal 6 karakter." });
        }

        const payload = JSON.stringify({
            estimate_hash: bcrypt.hashSync(estimatePassword, 10),
            wo_hash: bcrypt.hashSync(woPassword, 10)
        });
        db.prepare(`
            INSERT INTO app_storage (storage_key, data_json, updated_by, updated_at, workshop_id)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
            ON CONFLICT(storage_key, workshop_id) DO UPDATE SET
                data_json = excluded.data_json,
                updated_by = excluded.updated_by,
                updated_at = CURRENT_TIMESTAMP
        `).run("delete_password_settings", payload, req.user.user_id, requestWorkshopId(req));

        return res.json({ success:true, message:"Password Hapus Estimasi dan Hapus WO berhasil diperbarui." });
    } catch (error) {
        console.error("PUT DELETE PASSWORD SETTINGS ERROR:", error);
        return res.status(500).json({ success:false, message:"Gagal menyimpan Password Penghapusan." });
    }
});

// ============================================================
// CREATE / UPDATE USER
// Manager Master dapat membuat Manager Master lainnya dan user operasional.
// ============================================================

app.post(
    "/api/users",
    (req, res) => {
        try {
            if (!requireManagerMaster(req, res)) return;

            const username = teks(req.body?.username);
            const fullName = teks(req.body?.full_name);
            const password = String(req.body?.password || "");
            const roleId = Number(req.body?.role_id);
            const isActive = req.body?.is_active === undefined ? 1 : (Number(req.body.is_active) ? 1 : 0);

            if (!username || !fullName || !password || !Number.isInteger(roleId) || roleId <= 0) {
                return res.status(400).json({ success: false, message: "Nama User, Username, Password, dan Role wajib diisi." });
            }
            if (password.length < 6) {
                return res.status(400).json({ success: false, message: "Password minimal 6 karakter." });
            }

            const role = db.prepare(`SELECT id, name, code, description FROM roles WHERE id = ?`).get(roleId);
            if (!role) return res.status(400).json({ success: false, message: "Role tidak ditemukan." });

            const roleCode = String(role.code || "").trim().toUpperCase();
            const roleName = String(role.name || "").trim().toUpperCase();
            const allowed = roleCode === "MANAGER_MASTER" || roleName === "MANAGER MASTER" ||
                ["SERVICE_ADVISOR", "BILLING", "SPAREPART_GUDANG"].includes(roleCode) ||
                ["SERVICE ADVISOR", "BILLING", "SPAREPART / GUDANG", "SPAREPART GUDANG"].includes(roleName);
            if (!allowed) return res.status(403).json({ success: false, message: "Role tidak diizinkan." });

            const targetWorkshopId = currentRoleCode(req) === "SUPER ADMIN"
                ? Number(req.body?.workshop_id || 0)
                : Number(req.user.workshop_id || 0);
            if (!idValid(targetWorkshopId)) return res.status(400).json({ success:false, message:"Bengkel wajib dipilih." });
            const workshop = db.prepare(`SELECT id FROM workshops WHERE id = ? AND is_active = 1`).get(targetWorkshopId);
            if (!workshop) return res.status(400).json({ success:false, message:"Bengkel tidak ditemukan atau tidak aktif." });

            const duplicate = db.prepare(`SELECT id FROM users WHERE LOWER(username) = LOWER(?)`).get(username);
            if (duplicate) return res.status(409).json({ success: false, message: "Username sudah digunakan oleh user lain." });

            const result = db.prepare(`
                INSERT INTO users (username, password_hash, full_name, role_id, is_active, workshop_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).run(username, bcrypt.hashSync(password.toLowerCase(), 10), fullName, roleId, isActive, targetWorkshopId);

            const created = db.prepare(`
                SELECT users.id, users.username, users.full_name, users.role_id, users.is_active,
                       roles.code AS role_code, roles.name AS role_name, roles.description AS role_description,
                       users.created_at, users.updated_at
                FROM users INNER JOIN roles ON users.role_id = roles.id WHERE users.id = ?
            `).get(result.lastInsertRowid);

            return res.status(201).json({ success: true, message: "User baru berhasil dibuat.", data: created });
        } catch (error) {
            console.error("CREATE USER ERROR:", error);
            return res.status(500).json({ success: false, message: "Gagal membuat user baru." });
        }
    }
);

app.patch(
    "/api/users/:id",
    (req, res) => {
        try {
            if (!requireManagerMaster(req, res)) return;

            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: "ID user tidak valid." });

            const isSuperAdmin = currentRoleCode(req) === "SUPER ADMIN";
            const current = isSuperAdmin
                ? db.prepare(`SELECT id, username, full_name, role_id, is_active, workshop_id FROM users WHERE id = ?`).get(id)
                : db.prepare(`SELECT id, username, full_name, role_id, is_active, workshop_id FROM users WHERE id = ? AND workshop_id = ?`).get(id, requestWorkshopId(req));
            if (!current) return res.status(404).json({ success: false, message: "User tidak ditemukan atau bukan bagian dari bengkel Anda." });
            const targetRole = db.prepare(`SELECT code FROM roles WHERE id = ?`).get(current.role_id);
            if (String(targetRole?.code || "").toUpperCase() === "SUPER_ADMIN") return res.status(403).json({ success:false, message:"Akun Super Admin tidak dapat diubah dari User & Role bengkel." });
            if (currentRoleCode(req) === "MANAGER MASTER" && Number(current.workshop_id || 0) !== Number(req.user.workshop_id || 0)) return res.status(403).json({success:false,message:"User bukan bagian dari bengkel Anda."});

            const username = Object.prototype.hasOwnProperty.call(req.body || {}, "username") ? teks(req.body.username) : current.username;
            const fullName = Object.prototype.hasOwnProperty.call(req.body || {}, "full_name") ? teks(req.body.full_name) : (current.full_name || "");
            if (!username || !fullName) return res.status(400).json({ success: false, message: "Nama user dan username wajib diisi." });

            const duplicate = db.prepare(`SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?`).get(username, id);
            if (duplicate) return res.status(409).json({ success: false, message: "Username sudah digunakan oleh user lain." });

            let roleId = current.role_id;
            if (Object.prototype.hasOwnProperty.call(req.body || {}, "role_id")) {
                roleId = Number(req.body.role_id);
                const role = db.prepare(`SELECT id, name, code FROM roles WHERE id = ?`).get(roleId);
                if (!role) return res.status(400).json({ success: false, message: "Role tidak ditemukan." });
            }

            const isActive = Object.prototype.hasOwnProperty.call(req.body || {}, "is_active") ? (Number(req.body.is_active) ? 1 : 0) : Number(current.is_active) ? 1 : 0;
            if (currentRoleCode(req) === "SUPER ADMIN" && Object.prototype.hasOwnProperty.call(req.body || {}, "workshop_id")) {
                const targetWorkshopId = Number(req.body.workshop_id || 0);
                if (!idValid(targetWorkshopId)) return res.status(400).json({success:false,message:"Bengkel tidak valid."});
                const workshop = db.prepare(`SELECT id FROM workshops WHERE id = ? AND is_active = 1`).get(targetWorkshopId);
                if (!workshop) return res.status(400).json({success:false,message:"Bengkel tidak ditemukan atau tidak aktif."});
                db.prepare(`UPDATE users SET workshop_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(targetWorkshopId, id);
            }
            const password = String(req.body?.password || "");

            if (password && password.length < 6) return res.status(400).json({ success: false, message: "Password baru minimal 6 karakter." });

            if (password) {
                const sql = isSuperAdmin
                    ? `UPDATE users SET username = ?, full_name = ?, role_id = ?, is_active = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
                    : `UPDATE users SET username = ?, full_name = ?, role_id = ?, is_active = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workshop_id = ?`;
                const args = isSuperAdmin
                    ? [username, fullName, roleId, isActive, bcrypt.hashSync(password.toLowerCase(), 10), id]
                    : [username, fullName, roleId, isActive, bcrypt.hashSync(password.toLowerCase(), 10), id, requestWorkshopId(req)];
                db.prepare(sql).run(...args);
            } else {
                const sql = isSuperAdmin
                    ? `UPDATE users SET username = ?, full_name = ?, role_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
                    : `UPDATE users SET username = ?, full_name = ?, role_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workshop_id = ?`;
                const args = isSuperAdmin
                    ? [username, fullName, roleId, isActive, id]
                    : [username, fullName, roleId, isActive, id, requestWorkshopId(req)];
                db.prepare(sql).run(...args);
            }

            const updated = db.prepare(`
                SELECT users.id, users.username, users.full_name, users.role_id, users.is_active,
                       roles.code AS role_code, roles.name AS role_name, roles.description AS role_description,
                       users.created_at, users.updated_at
                FROM users INNER JOIN roles ON users.role_id = roles.id
                WHERE users.id = ? AND (? = 1 OR users.workshop_id = ?)
            `).get(id, isSuperAdmin ? 1 : 0, requestWorkshopId(req));

            return res.json({ success: true, message: "Data user berhasil diperbarui.", data: updated });
        } catch (error) {
            console.error("UPDATE USER ERROR:", error);
            return res.status(500).json({ success: false, message: "Gagal memperbarui data user." });
        }
    }
);


// ============================================================
// PAYMENT BANK ACCOUNTS
// Disimpan per bengkel agar rekening tidak tercampur antar bengkel.
// ============================================================
function getPaymentBankSettings(workshopId) {
    const key = `payment_bank_accounts_${Number(workshopId || 0)}`;
    const row = db.prepare(`SELECT data_json FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`).get(key, Number(workshopId || 0));
    if (!row?.data_json) return { or_account:{bank:"",account_number:"",account_name:""}, kuitansi_accounts:[] };
    try {
        const data = JSON.parse(row.data_json);
        return {
            or_account: data?.or_account || {bank:"",account_number:"",account_name:""},
            kuitansi_accounts: Array.isArray(data?.kuitansi_accounts) ? data.kuitansi_accounts : []
        };
    } catch (_) {
        return { or_account:{bank:"",account_number:"",account_name:""}, kuitansi_accounts:[] };
    }
}

app.get("/api/settings/payment-bank-accounts", (req,res) => {
    try {
        const workshopId = Number(req.user?.workshop_id || 0);
        if (!idValid(workshopId)) return res.status(400).json({success:false,message:"Bengkel tidak valid."});
        return res.json({success:true,data:getPaymentBankSettings(workshopId)});
    } catch(error) {
        console.error("GET PAYMENT BANK SETTINGS ERROR:",error);
        return res.status(500).json({success:false,message:"Gagal mengambil rekening pembayaran."});
    }
});

app.put("/api/settings/payment-bank-accounts", (req,res) => {
    try {
        const role = currentRoleCode(req);
        if (role !== "MANAGER MASTER" && role !== "SUPER ADMIN") return res.status(403).json({success:false,message:"Hanya Manager Master atau Super Admin yang dapat mengubah rekening pembayaran."});
        const workshopId = Number(req.body?.workshop_id || req.user?.workshop_id || 0);
        if (!idValid(workshopId)) return res.status(400).json({success:false,message:"Bengkel tidak valid."});
        if (role === "MANAGER MASTER" && workshopId !== Number(req.user.workshop_id || 0)) return res.status(403).json({success:false,message:"Anda hanya dapat mengubah rekening bengkel sendiri."});
        const payload = {
            or_account: {
                bank: teks(req.body?.or_account?.bank),
                account_number: teks(req.body?.or_account?.account_number),
                account_name: teks(req.body?.or_account?.account_name)
            },
            kuitansi_accounts: Array.isArray(req.body?.kuitansi_accounts) ? req.body.kuitansi_accounts.map((x,i)=>({
                id: x?.id || String(i+1), bank: teks(x?.bank), account_number: teks(x?.account_number), account_name: teks(x?.account_name)
            })).filter(x=>x.bank||x.account_number||x.account_name) : []
        };
        const key = `payment_bank_accounts_${workshopId}`;
        db.prepare(`INSERT INTO app_storage (storage_key,data_json,updated_by,updated_at,workshop_id) VALUES (?,?,?,?,?)
            ON CONFLICT(storage_key,workshop_id) DO UPDATE SET data_json=excluded.data_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
            .run(key,JSON.stringify(payload),req.user.user_id, new Date().toISOString(), workshopId);
        return res.json({success:true,message:"Rekening pembayaran berhasil disimpan.",data:payload});
    } catch(error) {
        console.error("PUT PAYMENT BANK SETTINGS ERROR:",error);
        return res.status(500).json({success:false,message:"Gagal menyimpan rekening pembayaran."});
    }
});

// ============================================================
// ROLES
// ============================================================

app.get(
    "/api/roles",
    (req, res) => {

        try {

            const roles =
                db.prepare(`
                    SELECT
                        id,
                        code,
                        name,
                        description
                    FROM roles
                    WHERE UPPER(COALESCE(code,'')) <> 'SUPER_ADMIN'
                    ORDER BY id ASC
                `).all();


            res.json({

                success: true,

                data:
                    roles
            });

        }

        catch (error) {

            console.error(
                "GET ROLES ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal mengambil data role."

                });
        }
    }
);


// ============================================================
// CUSTOMER
// ============================================================

// GET SEMUA CUSTOMER

app.get(
    "/api/customers",
    (req, res) => {

        try {

            const customers =
                db.prepare(`
                    SELECT

                        id,

                        customer_code,

                        name,

                        phone,

                        customer_type,

                        address,

                        notes,

                        created_at,

                        updated_at

                    FROM customers
                    WHERE workshop_id = ?

                    ORDER BY
                        id DESC
                `).all(Number(req.user?.workshop_id||0));


            res.json({

                success: true,

                data:
                    customers
            });

        }

        catch (error) {

            console.error(
                "GET CUSTOMER ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal mengambil data customer."

                });
        }
    }
);


// EXPORT CUSTOMER - EXCEL
app.get(
    "/api/customers/export/excel",
    (req, res) => {
        try {
            const workshopId = requestWorkshopId(req);
            const rows = db.prepare(`
                SELECT customer_code, name, phone, customer_type, address, notes, created_at
                FROM customers
                WHERE workshop_id = ?
                ORDER BY id ASC
            `).all(workshopId);

            const esc = (value) => String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");
            const workshop = db.prepare(`SELECT name FROM workshops WHERE id = ? LIMIT 1`).get(workshopId);
            const title = `Daftar Customer - ${workshop?.name || "MyWorkshop"}`;
            const bodyRows = rows.map((r, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>${esc(r.customer_code)}</td>
                    <td>${esc(r.name)}</td>
                    <td>${esc(r.phone)}</td>
                    <td>${esc(r.customer_type)}</td>
                    <td>${esc(r.address)}</td>
                    <td>${esc(r.notes)}</td>
                    <td>${esc(r.created_at)}</td>
                </tr>`).join("");
            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title><style>table{border-collapse:collapse;font-family:Arial;font-size:11pt}th,td{border:1px solid #999;padding:6px}th{font-weight:bold;background:#eee}</style></head><body><h3>${esc(title)}</h3><table><thead><tr><th>No</th><th>Kode Customer</th><th>Nama Customer</th><th>No. Telepon</th><th>Jenis</th><th>Alamat</th><th>Keterangan</th><th>Tanggal Dibuat</th></tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;
            res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
            res.setHeader("Content-Disposition", 'attachment; filename="Data-Customer.xls"');
            res.send("\\ufeff" + html);
        } catch (error) {
            console.error("EXPORT CUSTOMER EXCEL ERROR:", error);
            res.status(500).json({ success:false, message:"Gagal mengunduh data customer dalam Excel." });
        }
    }
);

// EXPORT CUSTOMER - PDF (PDF sederhana tanpa dependency tambahan)
app.get(
    "/api/customers/export/pdf",
    (req, res) => {
        try {
            const workshopId = requestWorkshopId(req);
            const rows = db.prepare(`
                SELECT customer_code, name, phone, customer_type, address, notes, created_at
                FROM customers
                WHERE workshop_id = ?
                ORDER BY id ASC
            `).all(workshopId);
            const workshop = db.prepare(`SELECT name FROM workshops WHERE id = ? LIMIT 1`).get(workshopId);
            const clean = (value) => String(value ?? "").replace(/[\\\r\n()]/g, ch => ch === "\\" ? "\\\\" : ch === "(" ? "\\(" : ch === ")" ? "\\)" : " ");
            const lines = [
                `Daftar Customer - ${workshop?.name || "MyWorkshop"}`,
                "",
                "No | Kode Customer | Nama Customer | Telepon | Jenis",
                ...rows.map((r,i) => `${i+1} | ${r.customer_code || ""} | ${r.name || ""} | ${r.phone || ""} | ${r.customer_type || ""}`)
            ];
            const pageW = 595, pageH = 842, left = 36, top = 800, lineH = 14;
            const pageCount = Math.max(1, Math.ceil(lines.length / 52));
            const objects = [];
            const pages = [];
            for (let p = 0; p < pageCount; p++) {
                const chunk = lines.slice(p * 52, (p + 1) * 52);
                const stream = ["BT", "/F1 9 Tf", `${left} ${top} Td`];
                chunk.forEach((line, idx) => { if (idx) stream.push(`0 -${lineH} Td`); stream.push(`(${clean(line).slice(0, 115)}) Tj`); });
                stream.push("ET");
                const content = stream.join("\n");
                const contentNum = objects.length + 1; objects.push(`<< /Length ${Buffer.byteLength(content,"latin1")} >>\nstream\n${content}\nendstream`);
                const pageNum = objects.length + 1; objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${pageCount + 3} 0 R >> >> /Contents ${contentNum} 0 R >>`); pages.push(pageNum);
            }
            const fontNum = objects.length + 1; objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
            const kids = pages.map(n => `${n} 0 R`).join(" ");
            objects.splice(1, 0, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
            // Rebuild references after insertion so object numbering is correct.
            const final = [];
            final.push("<< /Type /Catalog /Pages 2 0 R >>");
            const pageObjects = [];
            let oi = 3;
            for (let p = 0; p < pageCount; p++) {
                const chunk = lines.slice(p * 52, (p + 1) * 52);
                const stream = ["BT", "/F1 9 Tf", `${left} ${top} Td`];
                chunk.forEach((line, idx) => { if (idx) stream.push(`0 -${lineH} Td`); stream.push(`(${clean(line).slice(0, 115)}) Tj`); }); stream.push("ET");
                const contentNum = oi++; final.push(`<< /Length ${Buffer.byteLength(stream.join("\n"),"latin1")} >>\nstream\n${stream.join("\n")}\nendstream`);
                const pageNum = oi++; pageObjects.push(pageNum); final.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${2 + pageCount * 2 + 1} 0 R >> >> /Contents ${contentNum} 0 R >>`);
            }
            // Object 2 is Pages; font is last.
            const fontObject = final.length + 1;
            final.splice(1, 0, `<< /Type /Pages /Kids [${pageObjects.map(n => `${n} 0 R`).join(" ")}] /Count ${pageCount} >>`);
            final.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
            // Correct font reference to actual last object.
            const actualFont = final.length;
            for (let i=2; i<final.length-1; i++) final[i] = final[i].replace(/\/F1 \d+ 0 R/, `/F1 ${actualFont} 0 R`);
            let pdf = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n";
            const offsets = [0];
            final.forEach((obj, i) => { offsets[i+1] = Buffer.byteLength(pdf,"latin1"); pdf += `${i+1} 0 obj\n${obj}\nendobj\n`; });
            const xref = Buffer.byteLength(pdf,"latin1"); pdf += `xref\n0 ${final.length+1}\n0000000000 65535 f \n`; for(let i=1;i<=final.length;i++) pdf += `${String(offsets[i]).padStart(10,"0")} 00000 n \n`; pdf += `trailer\n<< /Size ${final.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", 'attachment; filename="Data-Customer.pdf"');
            res.send(Buffer.from(pdf,"latin1"));
        } catch (error) {
            console.error("EXPORT CUSTOMER PDF ERROR:", error);
            res.status(500).json({ success:false, message:"Gagal mengunduh data customer dalam PDF." });
        }
    }
);

// GET CUSTOMER BERDASARKAN ID

app.get(
    "/api/customers/:id",
    (req, res) => {

        try {

            const id =
                Number(
                    req.params.id
                );


            if (
                !idValid(id)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "ID customer tidak valid."

                    });
            }


            const customer =
                db.prepare(`
                    SELECT *
                    FROM customers
                    WHERE id = ? AND workshop_id = ?
                `).get(id, Number(req.user?.workshop_id||0));


            if (!customer) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "Customer tidak ditemukan."

                    });
            }


            res.json({

                success: true,

                data:
                    customer
            });

        }

        catch (error) {

            console.error(
                "GET CUSTOMER DETAIL ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal mengambil customer."

                });
        }
    }
);


// TAMBAH CUSTOMER

app.post(
    "/api/customers",
    (req, res) => {

        try {

            const nama =
                teks(
                    req.body.name
                );


            if (!nama) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "Nama customer wajib diisi."

                    });
            }


            const jenis =
                teks(
                    req.body.customer_type
                ).toUpperCase() ===
                "COMPANY"
                    ? "COMPANY"
                    : "INDIVIDUAL";


            const kode =
                generateCustomerCode(req.user?.workshop_id);


            const hasil =
                db.prepare(`
                    INSERT INTO customers
                    (
                        customer_code,
                        name,
                        phone,
                        customer_type,
                        address,
                        notes,
                        workshop_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(

                    kode,

                    nama,

                    teks(
                        req.body.phone
                    ),

                    jenis,

                    teks(
                        req.body.address
                    ),

                    teks(
                        req.body.notes
                    ),

                    Number(req.user?.workshop_id||0)
                );


            const customer =
                db.prepare(`
                    SELECT *
                    FROM customers
                    WHERE id = ? AND workshop_id = ?
                `).get(
                    hasil.lastInsertRowid, requestWorkshopId(req)
                );


            res
                .status(201)
                .json({

                    success: true,

                    message:
                        "Customer berhasil dibuat.",

                    data:
                        customer

                });

        }

        catch (error) {

            console.error(
                "POST CUSTOMER ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal membuat customer."

                });
        }
    }
);


// EDIT CUSTOMER

app.put(
    "/api/customers/:id",
    (req, res) => {

        try {

            const id =
                Number(
                    req.params.id
                );


            if (
                !idValid(id)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "ID customer tidak valid."

                    });
            }


            const nama =
                teks(
                    req.body.name
                );


            if (!nama) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "Nama customer wajib diisi."

                    });
            }


            const customer =
                db.prepare(`
                    SELECT id
                    FROM customers
                    WHERE id = ? AND workshop_id = ?
                `).get(id, requestWorkshopId(req));


            if (!customer) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "Customer tidak ditemukan."

                    });
            }


            const jenis =
                teks(
                    req.body.customer_type
                ).toUpperCase() ===
                "COMPANY"
                    ? "COMPANY"
                    : "INDIVIDUAL";


            db.prepare(`
                UPDATE customers

                SET

                    name = ?,

                    phone = ?,

                    customer_type = ?,

                    address = ?,

                    notes = ?,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ? AND workshop_id = ?
            `).run(

                nama,

                teks(
                    req.body.phone
                ),

                jenis,

                teks(
                    req.body.address
                ),

                teks(
                    req.body.notes
                ),

                id,
                requestWorkshopId(req)
            );


            const hasil =
                db.prepare(`
                    SELECT *
                    FROM customers
                    WHERE id = ? AND workshop_id = ?
                `).get(id, requestWorkshopId(req));


            res.json({

                success: true,

                message:
                    "Customer berhasil diperbarui.",

                data:
                    hasil
            });

        }

        catch (error) {

            console.error(
                "PUT CUSTOMER ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal memperbarui customer."

                });
        }
    }
);


// HAPUS CUSTOMER

app.delete(
    "/api/customers/:id",
    (req, res) => {

        try {

            const id =
                Number(
                    req.params.id
                );


            if (
                !idValid(id)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "ID customer tidak valid."

                    });
            }


            const customer =
                db.prepare(`
                    SELECT id
                    FROM customers
                    WHERE id = ? AND workshop_id = ?
                `).get(id, requestWorkshopId(req));


            if (!customer) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "Customer tidak ditemukan."

                    });
            }


            db.prepare(`
                DELETE FROM customers
                WHERE id = ? AND workshop_id = ?
            `).run(id, Number(req.user?.workshop_id||0));


            res.json({

                success: true,

                message:
                    "Customer berhasil dihapus."

            });

        }

        catch (error) {

            console.error(
                "DELETE CUSTOMER ERROR:",
                error
            );

            res
                .status(409)
                .json({

                    success: false,

                    message:
                        "Customer tidak dapat dihapus karena masih memiliki kendaraan atau estimasi."

                });
        }
    }
);


// ============================================================
// ASURANSI
// ============================================================

// ============================================================
// MASTER DATA ASURANSI
// ============================================================


// ============================================================
// MIGRATION KOLOM NOTES
// ============================================================

try {

    const columns =
        db.prepare(
            "PRAGMA table_info(insurers)"
        ).all();


    const hasNotes =
        columns.some(
            function (column) {

                return column.name === "notes";

            }
        );


    if (
        columns.length > 0 &&
        !hasNotes
    ) {

        db.exec(
            `
            ALTER TABLE insurers
            ADD COLUMN notes TEXT DEFAULT ''
            `
        );

        console.log(
            "Kolom insurers.notes berhasil ditambahkan."
        );

    }

}

catch (error) {

    console.error(
        "MIGRATION INSURERS ERROR:",
        error
    );

}


// ============================================================
// MIGRATION ASURANSI - NPWP / MATERIAL : LABOUR
// ============================================================
try {
    const insurerColumns = db.prepare("PRAGMA table_info(insurers)").all();

    if (!insurerColumns.some(column => column.name === "alias")) {
        db.exec(`ALTER TABLE insurers ADD COLUMN alias TEXT`);
        console.log("Kolom insurers.alias berhasil ditambahkan.");
    }

    if (!insurerColumns.some(column => column.name === "npwp")) {
        db.exec(`ALTER TABLE insurers ADD COLUMN npwp TEXT`);
        console.log("Kolom insurers.npwp berhasil ditambahkan.");
    }

    if (!insurerColumns.some(column => column.name === "material_percent")) {
        db.exec(`ALTER TABLE insurers ADD COLUMN material_percent REAL NOT NULL DEFAULT 0`);
        console.log("Kolom insurers.material_percent berhasil ditambahkan.");
    }
} catch (error) {
    console.error("MIGRATION INSURERS NPWP/SPLIT ERROR:", error);
}


// ============================================================
// GENERATE KODE ASURANSI
// ============================================================

function generateInsurerCode(workshopId) {

    const rows =
        db.prepare(
            `
            SELECT code
            FROM insurers
            WHERE code IS NOT NULL AND workshop_id = ?
            ORDER BY id DESC
            `
        ).all(Number(workshopId || 0));


    let maxNumber =
        0;


    rows.forEach(
        function (row) {

            const code =
                String(
                    row.code || ""
                );


            const match =
                code.match(
                    /(\d+)$/
                );


            if (match) {

                const number =
                    parseInt(
                        match[1],
                        10
                    );


                if (
                    number >
                    maxNumber
                ) {

                    maxNumber =
                        number;

                }

            }

        }
    );


    return (
        "INS-" +
        String(
            maxNumber + 1
        ).padStart(
            4,
            "0"
        )
    );

}


// ============================================================
// GET SEMUA ASURANSI
// ============================================================

app.get(
    "/api/asuransi",
    (req, res) => {

        try {

            const data =
                db.prepare(
                    `
                    SELECT

                        id,

                        code,

                        name,

                        alias,

                        npwp,

                        address,

                        phone,

                        material_percent,

                        notes,

                        is_active,

                        created_at,

                        updated_at

                    FROM insurers

                    WHERE workshop_id = ?

                    ORDER BY
                        id DESC
                    `
                ).all(requestWorkshopId(req));


            res.json({

                success:
                    true,

                data:
                    data

            });

        }

        catch (error) {

            console.error(
                "GET ASURANSI ERROR:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        "Gagal mengambil data asuransi."

                });

        }

    }
);


// ============================================================
// GET ASURANSI AKTIF
// ============================================================

app.get(
    "/api/asuransi/aktif",
    (req, res) => {

        try {

            const data =
                db.prepare(
                    `
                    SELECT

                        id,

                        code,

                        name,

                        alias,

                        npwp,

                        address,

                        phone,

                        material_percent

                    FROM insurers

                    WHERE
                        is_active = 1
                        AND workshop_id = ?

                    ORDER BY
                        name ASC
                    `
                ).all(requestWorkshopId(req));


            res.json({

                success:
                    true,

                data:
                    data

            });

        }

        catch (error) {

            console.error(
                "GET ASURANSI AKTIF ERROR:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        "Gagal mengambil data asuransi aktif."

                });

        }

    }
);


// ============================================================
// GET DETAIL ASURANSI
// ============================================================

app.get(
    "/api/asuransi/:id",
    (req, res) => {

        try {

            const id =
                Number(
                    req.params.id
                );


            if (
                !idValid(id)
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "ID asuransi tidak valid."

                    });

            }


            const data =
                db.prepare(
                    `
                    SELECT

                        id,

                        code,

                        name,

                        npwp,

                        address,

                        phone,

                        material_percent,

                        notes,

                        is_active,

                        created_at,

                        updated_at

                    FROM insurers

                    WHERE
                        id = ? AND workshop_id = ?

                    LIMIT 1
                    `
                ).get(
                    id, requestWorkshopId(req)
                );


            if (!data) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Asuransi tidak ditemukan."

                    });

            }


            res.json({

                success:
                    true,

                data:
                    data

            });

        }

        catch (error) {

            console.error(
                "GET DETAIL ASURANSI ERROR:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        "Gagal mengambil detail asuransi."

                });

        }

    }
);


// ============================================================
// TAMBAH ASURANSI
// ============================================================

app.post(
    "/api/asuransi",
    (req, res) => {

        try {

            const name =
                teks(
                    req.body.name
                );

            const alias =
                teks(
                    req.body.alias
                );


            const npwp =
                teks(
                    req.body.npwp
                );

            let materialPercent =
                Number(req.body.material_percent ?? req.body.materialPercent);

            if (!Number.isFinite(materialPercent)) materialPercent = 0;
            materialPercent = Math.max(0, Math.min(100, materialPercent));

            const address =
                teks(
                    req.body.address
                );


            const phone =
                teks(
                    req.body.phone
                );


            const notes =
                teks(
                    req.body.notes
                );


            if (!name) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Nama asuransi wajib diisi."

                    });

            }


            // CEK DUPLIKAT NAMA

            const duplicate =
                db.prepare(
                    `
                    SELECT id

                    FROM insurers

                    WHERE
                        LOWER(
                            TRIM(name)
                        )
                        =
                        LOWER(
                            TRIM(?)
                        )

                    AND workshop_id = ?

                    LIMIT 1
                    `
                ).get(
                    name, requestWorkshopId(req)
                );


            if (duplicate) {

                return res
                    .status(409)
                    .json({

                        success:
                            false,

                        message:
                            "Nama asuransi sudah terdaftar."

                    });

            }


            const isActive =
                (
                    req.body.is_active === false ||
                    String(
                        req.body.is_active
                    ) === "0"
                )
                    ? 0
                    : 1;


            const code =
                generateInsurerCode(requestWorkshopId(req));


            const result =
                db.prepare(
                    `
                    INSERT INTO insurers
                    (
                        code,
                        name,
                        alias,
                        npwp,
                        address,
                        phone,
                        material_percent,
                        notes,
                        is_active,
                        workshop_id
                    )

                    VALUES
                    (
                        ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?
                    )
                    `
                ).run(

                    code,

                    name,

                    alias,

                    npwp,

                    address,

                    phone,

                    materialPercent,

                    notes,

                    isActive,

                    requestWorkshopId(req)

                );


            const data =
                db.prepare(
                    `
                    SELECT

                        id,

                        code,

                        name,

                        npwp,

                        address,

                        phone,

                        material_percent,

                        notes,

                        is_active,

                        created_at,

                        updated_at

                    FROM insurers

                    WHERE
                        id = ? AND workshop_id = ?

                    LIMIT 1
                    `
                ).get(
                    result.lastInsertRowid, requestWorkshopId(req)
                );


            res
                .status(201)
                .json({

                    success:
                        true,

                    message:
                        "Asuransi berhasil ditambahkan.",

                    data:
                        data

                });

        }

        catch (error) {

            console.error(
                "POST ASURANSI ERROR:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        "Gagal menambahkan data asuransi."

                });

        }

    }
);


// ============================================================
// UPDATE ASURANSI
// ============================================================

app.put(
    "/api/asuransi/:id",
    (req, res) => {

        try {

            const id =
                Number(
                    req.params.id
                );


            if (
                !idValid(id)
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "ID asuransi tidak valid."

                    });

            }


            const current =
                db.prepare(
                    `
                    SELECT id
                    FROM insurers
                    WHERE id = ? AND workshop_id = ?
                    LIMIT 1
                    `
                ).get(
                    id, requestWorkshopId(req)
                );


            if (!current) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Asuransi tidak ditemukan."

                    });

            }


            const name =
                teks(
                    req.body.name
                );

            const alias =
                teks(
                    req.body.alias
                );


            const npwp =
                teks(
                    req.body.npwp
                );

            let materialPercent =
                Number(req.body.material_percent ?? req.body.materialPercent);

            if (!Number.isFinite(materialPercent)) materialPercent = 0;
            materialPercent = Math.max(0, Math.min(100, materialPercent));


            const address =
                teks(
                    req.body.address
                );


            const phone =
                teks(
                    req.body.phone
                );


            const notes =
                teks(
                    req.body.notes
                );


            if (!name) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Nama asuransi wajib diisi."

                    });

            }


            // CEK DUPLIKAT

            const duplicate =
                db.prepare(
                    `
                    SELECT id

                    FROM insurers

                    WHERE
                        LOWER(
                            TRIM(name)
                        )
                        =
                        LOWER(
                            TRIM(?)
                        )

                    AND id <> ?
                    AND workshop_id = ?

                    LIMIT 1
                    `
                ).get(

                    name,

                    id,

                    requestWorkshopId(req)

                );


            if (duplicate) {

                return res
                    .status(409)
                    .json({

                        success:
                            false,

                        message:
                            "Nama asuransi sudah digunakan."

                    });

            }


            const isActive =
                (
                    req.body.is_active === false ||
                    String(
                        req.body.is_active
                    ) === "0"
                )
                    ? 0
                    : 1;


            db.prepare(
                `
                UPDATE insurers

                SET

                    name = ?,

                    alias = ?,

                    npwp = ?,

                    address = ?,

                    phone = ?,

                    material_percent = ?,

                    notes = ?,

                    is_active = ?,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE
                    id = ? AND workshop_id = ?
                `
            ).run(

                name,

                alias,

                npwp,

                address,

                phone,

                materialPercent,

                notes,

                isActive,

                id,

                requestWorkshopId(req)

            );


            const data =
                db.prepare(
                    `
                    SELECT

                        id,

                        code,

                        name,

                        alias,

                        npwp,

                        address,

                        phone,

                        material_percent,

                        notes,

                        is_active,

                        created_at,

                        updated_at

                    FROM insurers

                    WHERE
                        id = ? AND workshop_id = ?

                    LIMIT 1
                    `
                ).get(
                    id, requestWorkshopId(req)
                );


            res.json({

                success:
                    true,

                message:
                    "Asuransi berhasil diperbarui.",

                data:
                    data

            });

        }

        catch (error) {

            console.error(
                "PUT ASURANSI ERROR:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        "Gagal memperbarui data asuransi."

                });

        }

    }
);


// ============================================================
// DELETE ASURANSI
// ============================================================

app.delete(
    "/api/asuransi/:id",
    (req, res) => {

        try {

            const id =
                Number(
                    req.params.id
                );


            if (
                !idValid(id)
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "ID asuransi tidak valid."

                    });

            }


            const insurer =
                db.prepare(
                    `
                    SELECT

                        id,

                        name

                    FROM insurers

                    WHERE
                        id = ? AND workshop_id = ?

                    LIMIT 1
                    `
                ).get(
                    id, requestWorkshopId(req)
                );


            if (!insurer) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Asuransi tidak ditemukan."

                    });

            }


            /*
             * Jangan menghapus asuransi yang sudah
             * digunakan oleh Estimasi.
             */

            const used =
                db.prepare(
                    `
                    SELECT id

                    FROM estimates

                    WHERE
                        insurer_id = ? AND workshop_id = ?

                    LIMIT 1
                    `
                ).get(
                    id, requestWorkshopId(req)
                );


            if (used) {

                return res
                    .status(409)
                    .json({

                        success:
                            false,

                        message:
                            "Asuransi tidak dapat dihapus karena sudah digunakan pada Estimasi. Ubah status menjadi Tidak Aktif."

                    });

            }


            db.prepare(
                `
                DELETE FROM insurers

                WHERE
                    id = ? AND workshop_id = ?
                `
            ).run(
                id, requestWorkshopId(req)
            );


            res.json({

                success:
                    true,

                message:
                    "Asuransi berhasil dihapus."

            });

        }

        catch (error) {

            console.error(
                "DELETE ASURANSI ERROR:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        "Gagal menghapus data asuransi."

                });

        }

    }
);


// ============================================================
// KENDARAAN
// ============================================================

// GET SEMUA KENDARAAN CUSTOMER

app.get(
    "/api/customers/:customerId/kendaraan",
    (req, res) => {

        try {

            const customerId =
                Number(
                    req.params.customerId
                );


            if (
                !idValid(customerId)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "ID customer tidak valid."

                    });
            }


            const kendaraan =
                db.prepare(`
                    SELECT

                        id,

                        customer_id,

                        plate_number,

                        brand,

                        model,

                        year,

                        color,

                        vin_number,

                        engine_number,

                        notes,

                        created_at,

                        updated_at

                    FROM vehicles

                    WHERE
                        customer_id = ? AND workshop_id = ?

                    ORDER BY
                        id DESC
                `).all(
                    customerId, requestWorkshopId(req)
                );


            res.json({

                success: true,

                data:
                    kendaraan
            });

        }

        catch (error) {

            console.error(
                "GET KENDARAAN ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal mengambil kendaraan."

                });
        }
    }
);


// TAMBAH KENDARAAN

app.post(
    "/api/customers/:customerId/kendaraan",
    (req, res) => {

        try {

            const customerId =
                Number(
                    req.params.customerId
                );


            if (
                !idValid(customerId)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "ID customer tidak valid."

                    });
            }


            const customer =
                db.prepare(`
                    SELECT id
                    FROM customers
                    WHERE id = ? AND workshop_id = ?
                `).get(
                    customerId, Number(req.user?.workshop_id||0)
                );


            if (!customer) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "Customer tidak ditemukan."

                    });
            }


            const plat =
                teks(
                    req.body.plate_number
                ).toUpperCase();


            if (!plat) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "Nomor polisi wajib diisi."

                    });
            }


            const existing =
                db.prepare(`
                    SELECT id
                    FROM vehicles
                    WHERE
                        customer_id = ?
                        AND workshop_id = ?
                        AND UPPER(plate_number) =
                            UPPER(?)
                    LIMIT 1
                `).get(
                    customerId,
                    requestWorkshopId(req),
                    plat
                );


            if (existing) {

                return res
                    .status(409)
                    .json({

                        success: false,

                        message:
                            "Kendaraan dengan nomor polisi tersebut sudah terdaftar."

                    });
            }


            const tahun =
                req.body.year === "" ||
                req.body.year === null ||
                req.body.year === undefined
                    ? null
                    : Number(
                        req.body.year
                    );


            const hasil =
                db.prepare(`
                    INSERT INTO vehicles
                    (
                        customer_id,
                        plate_number,
                        brand,
                        model,
                        year,
                        color,
                        vin_number,
                        engine_number,
                        notes,
                        workshop_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(

                    customerId,

                    plat,

                    teks(
                        req.body.brand
                    ),

                    teks(
                        req.body.model
                    ),

                    tahun,

                    teks(
                        req.body.color
                    ),

                    teks(
                        req.body.vin_number
                    ),

                    teks(
                        req.body.engine_number
                    ),

                    teks(
                        req.body.notes
                    ),

                    requestWorkshopId(req)
                );


            const kendaraan =
                db.prepare(`
                    SELECT *
                    FROM vehicles
                    WHERE id = ? AND workshop_id = ?
                `).get(
                    hasil.lastInsertRowid, requestWorkshopId(req)
                );


            res
                .status(201)
                .json({

                    success: true,

                    message:
                        "Kendaraan berhasil dibuat.",

                    data:
                        kendaraan

                });

        }

        catch (error) {

            console.error(
                "POST KENDARAAN ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal membuat kendaraan."

                });
        }
    }
);


// ============================================================
// ESTIMASI - DAFTAR
// ============================================================

app.get(
    "/api/estimasi",
    (req, res) => {

        try {

            const data =
                db.prepare(`
                    SELECT

                        e.id,

                        e.estimate_number,

                        e.estimate_date,

                        e.customer_id,

                        e.vehicle_id,

                        e.insurer_id,

                        e.claim_number,

                        e.polis_number,

                        e.agent,

                        e.status,

                        e.subtotal_sparepart,

                        e.discount_sparepart,

                        e.total_sparepart,

                        e.total_jasa,

                        e.total_jasa_lain,

                        e.subtotal,

                        e.discount,

                        e.total_after_discount,

                        e.ppn_percent,

                        e.ppn_type,

                        e.ppn_amount,

                        e.pph_percent,

                        e.material_percent,

                        e.labour_percent,

                        e.labour_amount,

                        e.pph_amount,

                        e.own_risk,

                        e.grand_total,

                        e.total_billed,

                        e.agent,

                        e.customer_note,

                        e.created_by,

                        COALESCE(u.full_name, u.username) AS created_by_name,

                        e.approved_at,

                        e.approved_by,

                        e.created_at,

                        e.updated_at,

                        EXISTS (
                            SELECT 1
                            FROM wo wa
                            WHERE wa.estimate_id = e.id
                        ) AS has_wo,

                        EXISTS (
                            SELECT 1
                            FROM wo wa
                            INNER JOIN tagihan_kuitansi tk ON tk.wo_id = wa.id
                            WHERE wa.estimate_id = e.id
                        ) AS has_kuitansi,

                        c.customer_code,

                        c.name AS customer_name,

                        c.phone AS customer_phone,

                        c.customer_type,

                        i.name AS insurer_name,

                        i.alias AS insurer_alias,

                        v.plate_number,

                        v.brand,

                        v.model,

                        v.year,

                        v.color,

                        v.vin_number,

                        v.engine_number

                    FROM estimates e

                    LEFT JOIN users u
                        ON e.created_by = u.id

                    INNER JOIN customers c
                        ON e.customer_id =
                           c.id

                    INNER JOIN vehicles v
                        ON e.vehicle_id =
                           v.id

                    LEFT JOIN insurers i
                        ON e.insurer_id =
                           i.id

                    WHERE e.workshop_id = ?
                      AND NOT EXISTS (
                        SELECT 1
                        FROM wo wa
                        INNER JOIN tagihan_kuitansi tk ON tk.wo_id = wa.id
                        WHERE wa.estimate_id = e.id
                    )

                    ORDER BY
                        e.id DESC
                `).all(Number(req.user?.workshop_id||0));


            res.json({

                success: true,

                data:
                    data
            });

        }

        catch (error) {

            console.error(
                "GET ESTIMASI ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal mengambil data estimasi."

                });
        }
    }
);


// ============================================================
// ESTIMASI SELESAI
// ============================================================

app.get(
    "/api/estimasi-selesai",
    (req, res) => {
        try {
            const data = db.prepare(`
                SELECT
                    e.*,
                    c.customer_code,
                    c.name AS customer_name,
                    c.phone AS customer_phone,
                    c.customer_type,
                    i.code AS insurer_code,
                    i.name AS insurer_name,
                    i.alias AS insurer_alias,
                    i.address AS insurer_address,
                    v.plate_number,
                    v.brand,
                    v.model,
                    v.year,
                    v.color,
                    v.color,
                    v.vin_number,
                    v.engine_number,
                    w.id AS wo_id,
                    w.wo_number,
                    w.check_in_at,
                    w.check_out_at,
                    pk.paid_at AS payment_paid_at,
                    pk.description AS payment_description
                FROM estimates e
                INNER JOIN customers c ON e.customer_id = c.id AND c.workshop_id = e.workshop_id
                INNER JOIN vehicles v ON e.vehicle_id = v.id AND v.workshop_id = e.workshop_id
                LEFT JOIN insurers i ON e.insurer_id = i.id
                LEFT JOIN wo w ON w.estimate_id = e.id AND w.workshop_id = e.workshop_id
                LEFT JOIN pembayaran_kuitansi pk ON pk.wo_id = w.id AND pk.workshop_id = w.workshop_id
                WHERE e.workshop_id = ?
                  AND EXISTS (
                    SELECT 1
                    FROM wo wa
                    INNER JOIN tagihan_kuitansi tk ON tk.wo_id = wa.id AND tk.workshop_id = wa.workshop_id
                    WHERE wa.estimate_id = e.id
                      AND wa.workshop_id = e.workshop_id
                )
                ORDER BY e.id DESC
            `).all(Number(req.user?.workshop_id||0));
            res.json({ success: true, data });
        } catch (error) {
            console.error("GET ESTIMASI SELESAI ERROR:", error);
            res.status(500).json({ success: false, message: "Gagal mengambil Estimasi Selesai." });
        }
    }
);


// ============================================================
// ESTIMASI CUSTOMER
// ============================================================

app.get(
    "/api/customers/:customerId/estimasi",
    (req, res) => {

        try {

            const customerId =
                Number(
                    req.params.customerId
                );


            if (
                !idValid(customerId)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "ID customer tidak valid."

                    });
            }


            const data =
                db.prepare(`
                    SELECT

                        e.id,

                        e.estimate_number,

                        e.estimate_date,

                        e.customer_id,

                        e.vehicle_id,

                        e.insurer_id,

                        e.claim_number,

                        e.polis_number,

                        e.agent,

                        e.status,

                        e.subtotal,

                        e.discount,

                        e.total_after_discount,

                        e.ppn_amount,

                        e.pph_amount,

                        e.own_risk,

                        e.grand_total,

                        e.total_billed,

                        e.customer_note,

                        v.plate_number,

                        v.brand,

                        v.model,

                        v.year,

                        v.color,

                        i.name AS insurer_name

                    FROM estimates e

                    INNER JOIN vehicles v
                        ON e.vehicle_id =
                           v.id

                    LEFT JOIN insurers i
                        ON e.insurer_id =
                           i.id

                    WHERE
                        e.customer_id = ? AND e.workshop_id = ?

                    ORDER BY
                        e.id DESC
                `).all(
                    customerId, requestWorkshopId(req)
                );


            res.json({

                success: true,

                data:
                    data
            });

        }

        catch (error) {

            console.error(
                "GET CUSTOMER ESTIMASI ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal mengambil estimasi customer."

                });
        }
    }
);


// ============================================================
// DETAIL ESTIMASI
// ============================================================

app.get(
    "/api/estimasi/:id",
    (req, res) => {

        try {

            const id =
                Number(
                    req.params.id
                );


            if (
                !idValid(id)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "ID estimasi tidak valid."

                    });
            }


            const estimasi =
                db.prepare(`
                    SELECT

                        e.*,

                        c.customer_code,

                        c.name AS customer_name,

                        c.phone AS customer_phone,

                        c.customer_type,

                        c.address AS customer_address,

                        c.notes AS customer_notes,

                        i.code AS insurer_code,

                        i.name AS insurer_name,

                        v.plate_number,

                        v.brand,

                        v.model,

                        v.year,

                        v.color,

                        v.vin_number,

                        v.engine_number,

                        v.notes AS vehicle_notes

                    FROM estimates e

                    INNER JOIN customers c
                        ON e.customer_id =
                           c.id

                    INNER JOIN vehicles v
                        ON e.vehicle_id =
                           v.id

                    LEFT JOIN insurers i
                        ON e.insurer_id = i.id AND i.workshop_id = e.workshop_id

                    WHERE
                        e.id = ? AND e.workshop_id = ?

                    LIMIT 1
                `).get(
                    id, requestWorkshopId(req)
                );


            if (!estimasi) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "Estimasi tidak ditemukan."

                    });
            }


            const spareparts =
                db.prepare(`
                    SELECT *
                    FROM estimate_spareparts
                    WHERE estimate_id = ? AND workshop_id = ?
                    ORDER BY
                        sequence ASC,
                        id ASC
                `).all(id, requestWorkshopId(req));


            const jasa =
                db.prepare(`
                    SELECT *
                    FROM estimate_services
                    WHERE estimate_id = ? AND workshop_id = ?
                    ORDER BY
                        sequence ASC,
                        id ASC
                `).all(id, requestWorkshopId(req));


            const jasaLain =
                db.prepare(`
                    SELECT *
                    FROM estimate_other_services
                    WHERE estimate_id = ? AND workshop_id = ?
                    ORDER BY
                        sequence ASC,
                        id ASC
                `).all(id, requestWorkshopId(req));


            // Estimasi Selesai harus dapat dibuka oleh Service Advisor
            // tanpa meminta endpoint Billing. Sertakan WO dan Kuitansi
            // langsung pada endpoint detail Estimasi yang sudah diizinkan
            // untuk Service Advisor.
            const wo = db.prepare(`
                SELECT
                    w.id AS wo_id,
                    w.wo_number,
                    w.status AS wo_status,
                    w.check_in_at,
                    w.check_out_at
                FROM wo w
                WHERE w.estimate_id = ? AND w.workshop_id = ?
                ORDER BY w.id DESC
                LIMIT 1
            `).get(id, requestWorkshopId(req));

            const kuitansi = wo
                ? db.prepare(`
                    SELECT
                        tk.id AS kuitansi_id, tk.kuitansi_number,
                        tk.grand_total AS kuitansi_grand_total,
                        tk.claim_number AS kuitansi_claim_number,
                        tk.polis_number AS kuitansi_polis_number,
                        tk.created_at AS kuitansi_created_at
                    FROM tagihan_kuitansi tk
                    WHERE tk.wo_id = ? AND tk.workshop_id = ?
                    LIMIT 1
                `).get(wo.wo_id, requestWorkshopId(req))
                : null;


            res.json({

                success: true,

                data: {

                    ...estimasi,

                    spareparts:
                        spareparts,

                    jasa:
                        jasa,

                    jasa_lain:
                        jasaLain,

                    wo_id:
                        wo?.wo_id ?? null,

                    wo_number:
                        wo?.wo_number ?? null,

                    wo_status:
                        wo?.wo_status ?? null,

                    check_in_at:
                        wo?.check_in_at ?? null,

                    check_out_at:
                        wo?.check_out_at ?? null,

                    kuitansi_id:
                        kuitansi?.kuitansi_id ?? null,

                    kuitansi_grand_total:
                        kuitansi?.kuitansi_grand_total ?? null,

                    kuitansi_claim_number:
                        kuitansi?.kuitansi_claim_number ?? null,

                    kuitansi_polis_number:
                        kuitansi?.kuitansi_polis_number ?? null,

                    kuitansi_created_at:
                        kuitansi?.kuitansi_created_at ?? null

                }

            });

        }

        catch (error) {

            console.error(
                "DETAIL ESTIMASI ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal mengambil detail estimasi."

                });
        }
    }
);


// ============================================================
// BUAT ESTIMASI
// ============================================================

app.post(
    "/api/estimasi",
    (req, res) => {

        try {

            const body =
                req.body;

            // Jika Estimasi dibuat dari Mobil Masuk, sumbernya akan ditandai
            // sebagai sudah terpakai setelah Estimasi berhasil disimpan.
            const mobilMasukId =
                Number(body.mobil_masuk_id) || null;


            let customerId =
                Number(
                    body.customer_id
                ) || 0;


            // Normalisasi satu format internal. Frontend memakai name/price/amount,
            // sedangkan tabel database memakai part_name/unit_price, dst.
            const spareparts = (Array.isArray(body.spareparts) ? body.spareparts : []).map(item => ({
                nama: teks(item.nama ?? item.name ?? item.part_name),
                sku: teks(item.sku ?? item.part_number),
                qty: angka(item.qty ?? item.quantity ?? 1),
                unit: teks(item.unit) || "PCS",
                harga: angka(item.harga ?? item.price ?? item.unit_price),
                diskon: angka(item.diskon ?? item.discount)
            }));

            const jasa = (Array.isArray(body.jasa) ? body.jasa : []).map(item => ({
                panel: teks(item.panel ?? item.panel_name),
                jenis: teks(item.jenis ?? item.service_type),
                qty: angka(item.qty ?? item.quantity ?? 1),
                unit: teks(item.unit) || "JOB",
                harga: angka(item.harga ?? item.amount ?? item.jumlah ?? item.unit_price),
                diskon: angka(item.diskon ?? item.discount)
            }));

            const jasaLain = (Array.isArray(body.jasa_lain ?? body.jasaLain) ? (body.jasa_lain ?? body.jasaLain) : []).map(item => ({
                nama: teks(item.nama ?? item.name ?? item.service_name),
                qty: angka(item.qty ?? item.quantity ?? 1),
                unit: teks(item.unit) || "JOB",
                harga: angka(item.harga ?? item.amount ?? item.jumlah ?? item.unit_price),
                diskon: angka(item.diskon ?? item.discount)
            }));


            const transaksi =
                db.transaction(() => {

                    // ==========================================
                    // CUSTOMER
                    // ==========================================

                    if (
                        customerId > 0
                    ) {

                        const customer =
                            db.prepare(`
                                SELECT id
                                FROM customers
                                WHERE id = ? AND workshop_id = ?
                            `).get(
                                customerId, requestWorkshopId(req)
                            );


                        if (!customer) {

                            throw new Error(
                                "Customer tidak ditemukan."
                            );
                        }
                    }

                    else {

                        const nama =
                            teks(
                                body.customer_name
                            );


                        if (!nama) {

                            throw new Error(
                                "Nama customer wajib diisi."
                            );
                        }


                        const kode =
                            generateCustomerCode(req.user?.workshop_id);


                        const hasil =
                            db.prepare(`
                                INSERT INTO customers
                                (
                                    customer_code,
                                    name,
                                    phone,
                                    customer_type,
                                    address,
                                    notes,
                                    workshop_id
                                )
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            `).run(

                                kode,

                                nama,

                                teks(
                                    body.customer_phone
                                ),

                                teks(
                                    body.customer_type
                                ).toUpperCase() ===
                                "COMPANY"
                                    ? "COMPANY"
                                    : "INDIVIDUAL",

                                teks(
                                    body.customer_address
                                ),

                                teks(
                                    body.customer_notes
                                ),
                                Number(req.user?.workshop_id||0)
                            );


                        customerId =
                            Number(
                                hasil.lastInsertRowid
                            );
                    }


                    // ==========================================
                    // MOBIL MASUK
                    // ==========================================
                    // Jika sumber Mobil Masuk dipilih, pastikan masih tersedia
                    // dan nomor polisi sama dengan yang digunakan pada Estimasi.
                    let mobilMasuk = null;

                    if (mobilMasukId) {
                        mobilMasuk = db.prepare(`
                            SELECT id, plate_number, used_estimate_id, used_at
                            FROM mobil_masuk
                            WHERE id = ? AND workshop_id = ?
                            LIMIT 1
                        `).get(mobilMasukId, requestWorkshopId(req));

                        if (!mobilMasuk) {
                            throw new Error("Data Mobil Masuk tidak ditemukan.");
                        }

                        if (mobilMasuk.used_at || mobilMasuk.used_estimate_id) {
                            throw new Error("Data Mobil Masuk sudah digunakan untuk Estimasi.");
                        }
                    }


                    // ==========================================
                    // KENDARAAN
                    // ==========================================

                    const nomorPolisi =
                        teks(
                            body.plate_number
                        ).toUpperCase();


                    if (!nomorPolisi) {

                        throw new Error(
                            "Nomor polisi wajib diisi."
                        );
                    }

                    if (mobilMasuk && String(mobilMasuk.plate_number || "").trim().toUpperCase() !== nomorPolisi) {
                        throw new Error("Nomor polisi Estimasi tidak sesuai dengan Mobil Masuk yang dipilih.");
                    }


                    const tahun =
                        body.year === "" ||
                        body.year === null ||
                        body.year === undefined
                            ? null
                            : Number(
                                body.year
                            );


                    let kendaraan =
                        db.prepare(`
                            SELECT *
                            FROM vehicles
                            WHERE

                                customer_id = ?
                                AND workshop_id = ?

                                AND UPPER(
                                    plate_number
                                ) = UPPER(?)

                            LIMIT 1
                        `).get(

                            customerId,

                            Number(req.user?.workshop_id||0),

                            nomorPolisi
                        );


                    let vehicleId;


                    if (!kendaraan) {

                        const hasil =
                            db.prepare(`
                                INSERT INTO vehicles
                                (
                                    customer_id,
                                    plate_number,
                                    brand,
                                    model,
                                    year,
                                    color,
                                    vin_number,
                                    engine_number,
                                    notes,
                                    workshop_id
                                )
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `).run(

                                customerId,

                                nomorPolisi,

                                teks(
                                    body.brand
                                ),

                                teks(
                                    body.model
                                ),

                                tahun,

                                teks(
                                    body.color
                                ),

                                teks(
                                    body.vin_number
                                ),

                                teks(
                                    body.engine_number
                                ),

                                teks(
                                    body.vehicle_notes
                                ),

                                Number(req.user?.workshop_id||0)
                            );


                        vehicleId =
                            Number(
                                hasil.lastInsertRowid
                            );
                    }

                    else {

                        vehicleId =
                            Number(
                                kendaraan.id
                            );


                        db.prepare(`
                            UPDATE vehicles

                            SET

                                brand = ?,

                                model = ?,

                                year = ?,

                                color = ?,

                                vin_number = ?,

                                engine_number = ?,

                                notes = ?,

                                updated_at =
                                    CURRENT_TIMESTAMP

                            WHERE id = ? AND workshop_id = ?
                        `).run(

                            teks(
                                body.brand
                            ),

                            teks(
                                body.model
                            ),

                            tahun,

                            teks(
                                body.color
                            ),

                            teks(
                                body.vin_number
                            ),

                            teks(
                                body.engine_number
                            ),

                            teks(
                                body.vehicle_notes
                            ),

                            vehicleId,
                            requestWorkshopId(req)
                        );
                    }


                    // ==========================================
                    // HITUNG
                    // ==========================================

                    const hitung =
                        hitungEstimasi({

                            spareparts,

                            jasa,

                            jasa_lain:

                                jasaLain,

                            diskon:

                                body.diskon,

                            discount_sparepart_type:
                                body.discount_sparepart_type ?? body.discountSparepartType,

                            discount_sparepart_value:
                                body.discount_sparepart_value ?? body.discountSparepartValue,

                            discount_jasa_type:
                                body.discount_jasa_type ?? body.discountJasaType,

                            discount_jasa_value:
                                body.discount_jasa_value ?? body.discountJasaValue,

                            ppn_persen:

                                body.ppn_persen,

                            ppn_type:

                                body.ppn_type ??
                                body.ppn_dasar,

                            material_percent:

                                body.material_percent ??
                                body.materialPercent,

                            own_risk:

                                body.or ??
                                body.own_risk

                        });


                    // ==========================================
                    // ASURANSI
                    // ==========================================

                    let insurerId =
                        Number(
                            body.insurer_id
                        ) || null;


                    if (
                        insurerId
                    ) {

                        const insurer =
                            db.prepare(`
                                SELECT id
                                FROM insurers
                                WHERE id = ? AND workshop_id = ?
                            `).get(
                                insurerId, requestWorkshopId(req)
                            );


                        if (!insurer) {

                            insurerId =
                                null;
                        }
                    }


                    // ==========================================
                    // STATUS
                    // ==========================================

                    const status =
                        [
                            "DRAFT",
                            "DIBUAT",
                            "APPROVED",
                            "CANCELLED"
                        ].includes(
                            teks(
                                body.status
                            ).toUpperCase()
                        )
                            ? teks(
                                body.status
                            ).toUpperCase()
                            : "DRAFT";


                    // ==========================================
                    // NOMOR ESTIMASI
                    // ==========================================

                    const nomorEstimasi =
                        generateEstimateNumber(req.user?.workshop_id);


                    // ==========================================
                    // SIMPAN ESTIMASI
                    // ==========================================

                    const hasilEstimasi =
                        db.prepare(`
                            INSERT INTO estimates
                            (
                                estimate_number,
                                estimate_date,
                                customer_id,
                                vehicle_id,
                                insurer_id,
                                status,
                                claim_number,
                                polis_number,
                                agent,
                                customer_note,
                                subtotal_sparepart,
                                discount_sparepart,
                                discount_sparepart_type,
                                discount_sparepart_value,
                                discount_jasa_type,
                                discount_jasa_value,
                                total_sparepart,
                                total_jasa,
                                total_jasa_lain,
                                subtotal,
                                discount,
                                total_after_discount,
                                ppn_percent,
                                ppn_type,
                                ppn_amount,
                                pph_percent,
                                material_percent,
                                labour_percent,
                                labour_amount,
                                pph_amount,
                                own_risk,
                                grand_total,
                                total_billed,
                                created_by,
                                workshop_id
                            )
                            VALUES
                            (
                                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                                ?, ?, ?, ?, ?
                            )
                        `).run(

                            nomorEstimasi,

                            teks(body.estimate_date) ||
                            new Date()
                                .toISOString()
                                .slice(0, 10),

                            customerId,

                            vehicleId,

                            insurerId,

                            status,

                            teks(body.claim_number),

                            teks(body.polis_number),

                            teks(body.agent),

                            teks(
                                body.customer_note
                            ),

                            hitung.subtotal_sparepart,

                            hitung.discount_sparepart,

                            hitung.discount_sparepart_type,

                            hitung.discount_sparepart_value,

                            hitung.discount_jasa_type,

                            hitung.discount_jasa_value,

                            hitung.total_sparepart,

                            hitung.total_jasa,

                            hitung.total_jasa_lain,

                            hitung.subtotal,

                            hitung.discount,

                            hitung.total_after_discount,

                            hitung.ppn_percent,

                            hitung.ppn_type,

                            hitung.ppn_amount,

                            hitung.pph_percent,

                            hitung.material_percent,

                            hitung.labour_percent,

                            hitung.labour_amount,

                            hitung.pph_amount,

                            hitung.own_risk,

                            hitung.grand_total,

                            hitung.total_billed,

                            auditUserId(req) || 1,

                            Number(req.user?.workshop_id||0)
                        );


                    const estimateId =
                        Number(
                            hasilEstimasi
                                .lastInsertRowid
                        );

                    // Estimasi berhasil dibuat -> Mobil Masuk langsung dianggap
                    // terpakai sehingga tidak lagi muncul di daftar Mobil Masuk.
                    if (mobilMasukId) {
                        const marked = db.prepare(`
                            UPDATE mobil_masuk
                            SET used_estimate_id = ?,
                                used_at = CURRENT_TIMESTAMP,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ? AND workshop_id = ?
                              AND used_at IS NULL
                              AND used_estimate_id IS NULL
                        `).run(estimateId, mobilMasukId, requestWorkshopId(req));

                        if (!marked.changes) {
                            throw new Error("Data Mobil Masuk sudah digunakan untuk Estimasi.");
                        }
                    }


                    // ==========================================
                    // SPAREPART
                    // ==========================================

                    const insertSparepart =
                        db.prepare(`
                            INSERT INTO
                            estimate_spareparts
                            (
                                estimate_id,
                                part_name,
                                part_number,
                                quantity,
                                unit,
                                unit_price,
                                discount,
                                total_price,
                                sequence,
                                workshop_id
                            )
                            VALUES
                            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `);


                    let sequence = 1;


                    spareparts.forEach(
                        item => {

                            const nama =
                                teks(
                                    item.nama ??
                                    item.name ??
                                    item.part_name
                                );


                            const nomorPart =
                                teks(
                                    item.sku ??
                                    item.part_number
                                );


                            const qty =
                                angka(
                                    item.qty ??
                                    item.quantity
                                );


                            const harga =
                                angka(
                                    item.harga ??
                                    item.price ??
                                    item.unit_price
                                );


                            const diskon =
                                angka(
                                    item.diskon ??
                                    item.discount
                                );


                            const total =
                                Math.max(
                                    0,
                                    (
                                        qty *
                                        harga
                                    ) -
                                    diskon
                                );


                            if (
                                nama ||
                                nomorPart ||
                                qty ||
                                harga
                            ) {

                                insertSparepart.run(

                                    estimateId,

                                    nama ||
                                    "Sparepart",

                                    nomorPart ||
                                    null,

                                    qty,

                                    teks(
                                        item.unit
                                    ) ||
                                    "PCS",

                                    harga,

                                    diskon,

                                    total,

                                    sequence++,

                                    Number(req.user?.workshop_id||0)
                                );
                            }
                        }
                    );


                    // ==========================================
                    // JASA
                    // ==========================================

                    const insertJasa =
                        db.prepare(`
                            INSERT INTO
                            estimate_services
                            (
                                estimate_id,
                                panel_name,
                                service_type,
                                quantity,
                                unit,
                                unit_price,
                                discount,
                                total_price,
                                sequence,
                                workshop_id
                            )
                            VALUES
                            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `);


                    jasa.forEach(
                        item => {

                            const panel =
                                teks(
                                    item.panel ??
                                    item.panel_name
                                );


                            const jenis =
                                teks(
                                    item.jenis ??
                                    item.service_type
                                );


                            const qty =
                                angka(
                                    item.qty ??
                                    item.quantity ??
                                    1
                                );


                            const harga =
                                angka(
                                    item.harga ??
                                    item.jumlah ??
                                    item.amount ??
                                    item.unit_price
                                );


                            const diskon =
                                angka(
                                    item.diskon ??
                                    item.discount
                                );


                            const total =
                                Math.max(
                                    0,
                                    (
                                        qty *
                                        harga
                                    ) -
                                    diskon
                                );


                            if (
                                panel ||
                                jenis ||
                                harga
                            ) {

                                insertJasa.run(

                                    estimateId,

                                    panel ||
                                    "Jasa Perbaikan / Pengecatan",

                                    jenis ||
                                    "Service",

                                    qty,

                                    teks(
                                        item.unit
                                    ) ||
                                    "JOB",

                                    harga,

                                    diskon,

                                    total,

                                    sequence++,

                                    Number(req.user?.workshop_id||0)
                                );
                            }
                        }
                    );


                    // ==========================================
                    // JASA LAIN-LAIN
                    // ==========================================

                    const insertJasaLain =
                        db.prepare(`
                            INSERT INTO
                            estimate_other_services
                            (
                                estimate_id,
                                service_name,
                                quantity,
                                unit,
                                unit_price,
                                discount,
                                total_price,
                                sequence,
                                workshop_id
                            )
                            VALUES
                            (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `);


                    jasaLain.forEach(
                        item => {

                            const nama =
                                teks(
                                    item.nama ??
                                    item.name ??
                                    item.service_name
                                );


                            const qty =
                                angka(
                                    item.qty ??
                                    item.quantity ??
                                    1
                                );


                            const harga =
                                angka(
                                    item.harga ??
                                    item.jumlah ??
                                    item.unit_price
                                );


                            const diskon =
                                angka(
                                    item.diskon ??
                                    item.discount
                                );


                            const total =
                                Math.max(
                                    0,
                                    (
                                        qty *
                                        harga
                                    ) -
                                    diskon
                                );


                            if (
                                nama ||
                                harga
                            ) {

                                insertJasaLain.run(

                                    estimateId,

                                    nama ||
                                    "Jasa Lain-lain",

                                    qty,

                                    teks(
                                        item.unit
                                    ) ||
                                    "JOB",

                                    harga,

                                    diskon,

                                    total,

                                    sequence++,

                                    Number(req.user?.workshop_id||0)
                                );
                            }
                        }
                    );


                    return {
                        estimate_id: estimateId,
                        estimate_number: nomorEstimasi,
                        customer_id: customerId,
                        vehicle_id: vehicleId,
                        calculation: hitung
                    };
                });

            // WAJIB menjalankan transaksi. Tanpa ini fungsi INSERT hanya
            // didefinisikan tetapi tidak pernah dieksekusi.
            const saved = transaksi();
            const detail = db.prepare(`
                SELECT e.*, c.customer_code, c.name AS customer_name, c.phone AS customer_phone,
                       c.customer_type, c.address AS customer_address, c.notes AS customer_notes,
                       i.code AS insurer_code, i.name AS insurer_name, i.alias AS insurer_alias,
                       v.plate_number, v.brand, v.model, v.year, v.color, v.vin_number, v.engine_number,
                       v.notes AS vehicle_notes
                FROM estimates e
                INNER JOIN customers c ON e.customer_id = c.id AND c.workshop_id = e.workshop_id
                INNER JOIN vehicles v ON e.vehicle_id = v.id AND v.workshop_id = e.workshop_id
                LEFT JOIN insurers i ON e.insurer_id = i.id AND i.workshop_id = e.workshop_id
                WHERE e.id = ? AND e.workshop_id = ? LIMIT 1
            `).get(saved.estimate_id, requestWorkshopId(req));
            detail.spareparts = db.prepare(`SELECT * FROM estimate_spareparts WHERE estimate_id=? AND workshop_id=? ORDER BY sequence,id`).all(saved.estimate_id, requestWorkshopId(req));
            detail.jasa = db.prepare(`SELECT * FROM estimate_services WHERE estimate_id=? AND workshop_id=? ORDER BY sequence,id`).all(saved.estimate_id, requestWorkshopId(req));
            detail.jasa_lain = db.prepare(`SELECT * FROM estimate_other_services WHERE estimate_id=? AND workshop_id=? ORDER BY sequence,id`).all(saved.estimate_id, requestWorkshopId(req));

            res.status(201).json({
                success: true,
                message: "Estimasi berhasil dibuat.",
                data: detail
            });

        }

        catch (error) {

            console.error(
                "POST ESTIMASI ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        error.message ||
                        "Gagal menyimpan estimasi."

                });
        }
    }
);


// ============================================================
// UPDATE ESTIMASI
// ============================================================

app.put(
    "/api/estimasi/:id",
    (req, res) => {

        try {

            const id =
                Number(
                    req.params.id
                );


            if (
                !idValid(id)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "ID estimasi tidak valid."

                    });
            }


            const estimasi =
                db.prepare(`
                    SELECT *
                    FROM estimates
                    WHERE id = ? AND workshop_id = ?
                `).get(id, requestWorkshopId(req));


            if (!estimasi) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "Estimasi tidak ditemukan."

                    });
            }


            const body =
                req.body;


            const customerId =
                Number(
                    body.customer_id
                ) ||
                Number(
                    estimasi.customer_id
                );


            const customer =
                db.prepare(`
                    SELECT id
                    FROM customers
                    WHERE id = ? AND workshop_id = ?
                `).get(
                    customerId, Number(req.user?.workshop_id||0)
                );


            if (!customer) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "Customer tidak ditemukan."

                    });
            }


            const nomorPolisi =
                teks(
                    body.plate_number
                ).toUpperCase();


            if (!nomorPolisi) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "Nomor polisi wajib diisi."

                    });
            }


            const tahun =
                body.year === "" ||
                body.year === null ||
                body.year === undefined
                    ? null
                    : Number(
                        body.year
                    );


            const transaksi =
                db.transaction(() => {

                    // ==========================================
                    // KENDARAAN
                    // ==========================================

                    let kendaraan =
                        db.prepare(`
                            SELECT *
                            FROM vehicles
                            WHERE

                                customer_id = ?
                                AND workshop_id = ?

                                AND UPPER(
                                    plate_number
                                ) = UPPER(?)

                            LIMIT 1
                        `).get(

                            customerId,

                            Number(req.user?.workshop_id||0),

                            nomorPolisi
                        );


                    let vehicleId;


                    if (!kendaraan) {

                        const hasil =
                            db.prepare(`
                                INSERT INTO vehicles
                                (
                                    customer_id,
                                    plate_number,
                                    brand,
                                    model,
                                    year,
                                    color,
                                    vin_number,
                                    engine_number,
                                    notes,
                                    workshop_id
                                )
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `).run(

                                customerId,

                                nomorPolisi,

                                teks(
                                    body.brand
                                ),

                                teks(
                                    body.model
                                ),

                                tahun,

                                teks(
                                    body.color
                                ),

                                teks(
                                    body.vin_number
                                ),

                                teks(
                                    body.engine_number
                                ),

                                teks(
                                    body.vehicle_notes
                                ),

                                Number(req.user?.workshop_id||0)
                            );


                        vehicleId =
                            Number(
                                hasil.lastInsertRowid
                            );

                    }

                    else {

                        vehicleId =
                            Number(
                                kendaraan.id
                            );


                        db.prepare(`
                            UPDATE vehicles

                            SET

                                brand = ?,

                                model = ?,

                                year = ?,

                                color = ?,

                                vin_number = ?,

                                engine_number = ?,

                                notes = ?,

                                updated_at =
                                    CURRENT_TIMESTAMP

                            WHERE id = ? AND workshop_id = ?
                        `).run(

                            teks(
                                body.brand
                            ),

                            teks(
                                body.model
                            ),

                            tahun,

                            teks(
                                body.color
                            ),

                            teks(
                                body.vin_number
                            ),

                            teks(
                                body.engine_number
                            ),

                            teks(
                                body.vehicle_notes
                            ),

                            vehicleId,
                            requestWorkshopId(req)
                        );
                    }


                    // ==========================================
                    // HITUNG
                    // ==========================================

                    const spareparts = (Array.isArray(body.spareparts) ? body.spareparts : []).map(item => ({
                        nama: teks(item.nama ?? item.name ?? item.part_name), sku: teks(item.sku ?? item.part_number),
                        qty: angka(item.qty ?? item.quantity ?? 1), unit: teks(item.unit) || "PCS",
                        harga: angka(item.harga ?? item.price ?? item.unit_price), diskon: angka(item.diskon ?? item.discount)
                    }));
                    const jasa = (Array.isArray(body.jasa) ? body.jasa : []).map(item => ({
                        panel: teks(item.panel ?? item.panel_name), jenis: teks(item.jenis ?? item.service_type),
                        qty: angka(item.qty ?? item.quantity ?? 1), unit: teks(item.unit) || "JOB",
                        harga: angka(item.harga ?? item.amount ?? item.jumlah ?? item.unit_price), diskon: angka(item.diskon ?? item.discount)
                    }));
                    const jasaLain = (Array.isArray(body.jasa_lain ?? body.jasaLain) ? (body.jasa_lain ?? body.jasaLain) : []).map(item => ({
                        nama: teks(item.nama ?? item.name ?? item.service_name), qty: angka(item.qty ?? item.quantity ?? 1),
                        unit: teks(item.unit) || "JOB", harga: angka(item.harga ?? item.amount ?? item.jumlah ?? item.unit_price), diskon: angka(item.diskon ?? item.discount)
                    }));


                    const hitung =
                        hitungEstimasi({

                            spareparts,

                            jasa,

                            jasa_lain:
                                jasaLain,

                            diskon:
                                body.diskon,
                            discount_sparepart_type:
                                body.discount_sparepart_type ?? body.discountSparepartType,
                            discount_sparepart_value:
                                body.discount_sparepart_value ?? body.discountSparepartValue,
                            discount_jasa_type:
                                body.discount_jasa_type ?? body.discountJasaType,
                            discount_jasa_value:
                                body.discount_jasa_value ?? body.discountJasaValue,

                            ppn_persen:
                                body.ppn_persen,

                            ppn_type:
                                body.ppn_type ??
                                body.ppn_dasar,

                            material_percent:
                                body.material_percent ??
                                body.materialPercent,

                            own_risk:
                                body.or ??
                                body.own_risk
                        });


                    // ==========================================
                    // ASURANSI
                    // ==========================================

                    let insurerId =
                        Number(
                            body.insurer_id
                        ) || null;


                    if (
                        insurerId
                    ) {

                        const insurer =
                            db.prepare(`
                                SELECT id
                                FROM insurers
                                WHERE id = ? AND workshop_id = ?
                            `).get(
                                insurerId, requestWorkshopId(req)
                            );


                        if (!insurer) {

                            insurerId =
                                null;
                        }
                    }


                    // ==========================================
                    // STATUS
                    // ==========================================

                    const status =
                        [
                            "DRAFT",
                            "DIBUAT",
                            "APPROVED",
                            "CANCELLED"
                        ].includes(
                            teks(
                                body.status ||
                                estimasi.status
                            ).toUpperCase()
                        )
                            ? teks(
                                body.status ||
                                estimasi.status
                            ).toUpperCase()
                            : "DRAFT";


                    // ==========================================
                    // UPDATE ESTIMASI
                    // ==========================================

                    db.prepare(`
                        UPDATE estimates

                        SET

                            customer_id = ?,

                            vehicle_id = ?,

                            insurer_id = ?,

                            estimate_date = ?,

                            status = ?,

                            claim_number = ?,

                            polis_number = ?,

                            agent = ?,

                            customer_note = ?,

                            subtotal_sparepart = ?,

                            discount_sparepart = ?,

                            total_sparepart = ?,

                            total_jasa = ?,

                            total_jasa_lain = ?,

                            subtotal = ?,

                            discount = ?,

                            total_after_discount = ?,

                            ppn_percent = ?,

                            ppn_type = ?,

                            ppn_amount = ?,

                            pph_percent = ?,

                            material_percent = ?,

                            labour_percent = ?,

                            labour_amount = ?,

                            pph_amount = ?,

                            own_risk = ?,

                            grand_total = ?,

                            total_billed = ?,

                            updated_at =
                                CURRENT_TIMESTAMP

                        WHERE id = ? AND workshop_id = ?
                    `).run(

                        customerId,

                        vehicleId,

                        insurerId,

                        teks(body.estimate_date) || estimasi.estimate_date,

                        status,

                        teks(body.claim_number),

                        teks(body.polis_number),

                        teks(body.agent),

                        teks(
                            body.customer_note
                        ),

                        hitung.subtotal_sparepart,

                        hitung.discount_sparepart,

                        hitung.total_sparepart,

                        hitung.total_jasa,

                        hitung.total_jasa_lain,

                        hitung.subtotal,

                        hitung.discount,

                        hitung.total_after_discount,

                        hitung.ppn_percent,

                        hitung.ppn_type,

                        hitung.ppn_amount,

                        hitung.pph_percent,

                        hitung.material_percent,

                        hitung.labour_percent,

                        hitung.labour_amount,

                        hitung.pph_amount,

                        hitung.own_risk,

                        hitung.grand_total,

                        hitung.total_billed,

                        id,
                        requestWorkshopId(req)
                    );


                    // ==========================================
                    // PERTAHANKAN SUMBER SPAREPART WO/ESTIMASI
                    // ==========================================
                    const existingSparepartRows = db.prepare(`
                        SELECT sequence, part_name, part_number, supply_bengkel
                        FROM estimate_spareparts
                        WHERE estimate_id = ? AND workshop_id = ?
                        ORDER BY sequence, id
                    `).all(id, requestWorkshopId(req));
                    const normalizeSupply = value =>
                        String(value || "BENGKEL").trim().toUpperCase() === "SUPPLY" ? "SUPPLY" : "BENGKEL";
                    const normalizePartKey = (name, number) =>
                        `${teks(number).trim().toUpperCase()}\u001f${teks(name).trim().toUpperCase()}`;
                    const existingSupplyByKey = new Map();
                    const existingSupplyBySequence = new Map();
                    existingSparepartRows.forEach(row => {
                        const supply = normalizeSupply(row.supply_bengkel);
                        const key = normalizePartKey(row.part_name, row.part_number);
                        if (key !== "\u001f") existingSupplyByKey.set(key, supply);
                        if (teks(row.part_number).trim()) existingSupplyByKey.set(normalizePartKey("", row.part_number), supply);
                        if (teks(row.part_name).trim()) existingSupplyByKey.set(normalizePartKey(row.part_name, ""), supply);
                        existingSupplyBySequence.set(Number(row.sequence), supply);
                    });

                    // ==========================================
                    // HAPUS DETAIL LAMA
                    // ==========================================

                    db.prepare(`
                        DELETE FROM
                        estimate_spareparts
                        WHERE estimate_id = ? AND workshop_id = ?
                    `).run(id, requestWorkshopId(req));


                    db.prepare(`
                        DELETE FROM
                        estimate_services
                        WHERE estimate_id = ? AND workshop_id = ?
                    `).run(id, requestWorkshopId(req));


                    db.prepare(`
                        DELETE FROM
                        estimate_other_services
                        WHERE estimate_id = ? AND workshop_id = ?
                    `).run(id, requestWorkshopId(req));


                    // ==========================================
                    // SIMPAN SPAREPART
                    // ==========================================

                    const insertSparepart =
                        db.prepare(`
                            INSERT INTO
                            estimate_spareparts
                            (
                                estimate_id,
                                part_name,
                                part_number,
                                quantity,
                                unit,
                                unit_price,
                                discount,
                                total_price,
                                sequence,
                                workshop_id,
                                supply_bengkel
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `);


                    let sequence = 1;


                    spareparts.forEach(
                        item => {

                            const nama =
                                teks(
                                    item.nama ??
                                    item.part_name
                                );


                            const nomorPart =
                                teks(
                                    item.sku ??
                                    item.part_number
                                );


                            const qty =
                                angka(
                                    item.qty ??
                                    item.quantity
                                );


                            const harga =
                                angka(
                                    item.harga ??
                                    item.unit_price
                                );


                            const diskon =
                                angka(
                                    item.diskon ??
                                    item.discount
                                );


                            const total =
                                Math.max(
                                    0,
                                    (
                                        qty *
                                        harga
                                    ) -
                                    diskon
                                );


                            if (
                                nama ||
                                nomorPart ||
                                qty ||
                                harga
                            ) {
                                const currentSequence = sequence++;
                                const key = normalizePartKey(nama, nomorPart);
                                const persistedSupply =
                                    existingSupplyByKey.get(key)
                                    ?? existingSupplyByKey.get(normalizePartKey("", nomorPart))
                                    ?? existingSupplyByKey.get(normalizePartKey(nama, ""))
                                    ?? existingSupplyBySequence.get(currentSequence);
                                const incomingSupply = item?.supply_bengkel ?? item?.supplyBengkel ?? item?.supply;
                                const supply = persistedSupply !== undefined
                                    ? normalizeSupply(persistedSupply)
                                    : normalizeSupply(incomingSupply);

                                insertSparepart.run(

                                    id,

                                    nama ||
                                    "Sparepart",

                                    nomorPart ||
                                    null,

                                    qty,

                                    teks(
                                        item.unit
                                    ) ||
                                    "PCS",

                                    harga,

                                    diskon,

                                    total,

                                    currentSequence,

                                    requestWorkshopId(req),

                                    supply
                                );
                            }
                        }
                    );


                    // ==========================================
                    // SIMPAN JASA
                    // ==========================================

                    const insertJasa =
                        db.prepare(`
                            INSERT INTO
                            estimate_services
                            (
                                estimate_id,
                                panel_name,
                                service_type,
                                quantity,
                                unit,
                                unit_price,
                                discount,
                                total_price,
                                sequence,
                                workshop_id
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `);


                    jasa.forEach(
                        item => {

                            const panel =
                                teks(
                                    item.panel ??
                                    item.panel_name
                                );


                            const jenis =
                                teks(
                                    item.jenis ??
                                    item.service_type
                                );


                            const qty =
                                angka(
                                    item.qty ??
                                    item.quantity ??
                                    1
                                );


                            const harga =
                                angka(
                                    item.harga ??
                                    item.jumlah ??
                                    item.unit_price
                                );


                            const diskon =
                                angka(
                                    item.diskon ??
                                    item.discount
                                );


                            const total =
                                Math.max(
                                    0,
                                    (
                                        qty *
                                        harga
                                    ) -
                                    diskon
                                );


                            if (
                                panel ||
                                jenis ||
                                harga
                            ) {

                                insertJasa.run(

                                    id,

                                    panel ||
                                    "Jasa Perbaikan / Pengecatan",

                                    jenis ||
                                    "Service",

                                    qty,

                                    teks(
                                        item.unit
                                    ) ||
                                    "JOB",

                                    harga,

                                    diskon,

                                    total,

                                    sequence++,

                                    requestWorkshopId(req)
                                );
                            }
                        }
                    );


                    // ==========================================
                    // SIMPAN JASA LAIN
                    // ==========================================

                    const insertJasaLain =
                        db.prepare(`
                            INSERT INTO
                            estimate_other_services
                            (
                                estimate_id,
                                service_name,
                                quantity,
                                unit,
                                unit_price,
                                discount,
                                total_price,
                                sequence,
                                workshop_id
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `);


                    jasaLain.forEach(
                        item => {

                            const nama =
                                teks(
                                    item.nama ??
                                    item.service_name
                                );


                            const qty =
                                angka(
                                    item.qty ??
                                    item.quantity ??
                                    1
                                );


                            const harga =
                                angka(
                                    item.harga ??
                                    item.jumlah ??
                                    item.unit_price
                                );


                            const diskon =
                                angka(
                                    item.diskon ??
                                    item.discount
                                );


                            const total =
                                Math.max(
                                    0,
                                    (
                                        qty *
                                        harga
                                    ) -
                                    diskon
                                );


                            if (
                                nama ||
                                harga
                            ) {

                                insertJasaLain.run(

                                    id,

                                    nama ||
                                    "Jasa Lain-lain",

                                    qty,

                                    teks(
                                        item.unit
                                    ) ||
                                    "JOB",

                                    harga,

                                    diskon,

                                    total,

                                    sequence++,

                                    requestWorkshopId(req)
                                );
                            }
                        }
                    );


                    return {
                        estimate_id: id,
                        customer_id: customerId,
                        vehicle_id: vehicleId,
                        calculation: hitung
                    };
                });

            // Jalankan transaksi UPDATE; sebelumnya fungsi hanya didefinisikan.
            transaksi();

            const detail = db.prepare(`
                SELECT e.*, c.customer_code, c.name AS customer_name, c.phone AS customer_phone,
                       c.customer_type, c.address AS customer_address, c.notes AS customer_notes,
                       i.code AS insurer_code, i.name AS insurer_name,
                       v.plate_number, v.brand, v.model, v.year, v.color, v.vin_number, v.engine_number,
                       v.notes AS vehicle_notes
                FROM estimates e
                INNER JOIN customers c ON e.customer_id = c.id
                INNER JOIN vehicles v ON e.vehicle_id = v.id
                LEFT JOIN insurers i ON e.insurer_id = i.id
                WHERE e.id = ? AND e.workshop_id = ?
                  AND c.workshop_id = e.workshop_id
                  AND v.workshop_id = e.workshop_id
                  AND (i.id IS NULL OR i.workshop_id = e.workshop_id)
                LIMIT 1
            `).get(id, requestWorkshopId(req));
            detail.spareparts = db.prepare(`SELECT * FROM estimate_spareparts WHERE estimate_id=? AND workshop_id=? ORDER BY sequence,id`).all(id, requestWorkshopId(req));
            detail.jasa = db.prepare(`SELECT * FROM estimate_services WHERE estimate_id=? AND workshop_id=? ORDER BY sequence,id`).all(id, requestWorkshopId(req));
            detail.jasa_lain = db.prepare(`SELECT * FROM estimate_other_services WHERE estimate_id=? AND workshop_id=? ORDER BY sequence,id`).all(id, requestWorkshopId(req));

            res.json({
                success: true,
                message: "Estimasi berhasil diperbarui.",
                data: detail
            });

        }

        catch (error) {

            console.error(
                "PUT ESTIMASI ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        error.message ||
                        "Gagal memperbarui estimasi."

                });
        }
    }
);


// ============================================================
// SYNC NETTO HARGA JUAL SPAREPART BENGKEL DARI PO KE ESTIMASI
// Hanya sparepart BENGKEL yang dapat mengubah nilai Estimasi.
// ============================================================
app.put("/api/estimasi/:id/sparepart-netto-jual", (req, res) => {
    try {
        const estimateId = Number(req.params.id);
        const workshopId = Number(req.user?.workshop_id || 0);
        if (!idValid(estimateId)) return res.status(400).json({ success:false, message:"ID estimasi tidak valid." });
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        if (!items.length) return res.json({ success:true, message:"Tidak ada nilai sparepart yang perlu disinkronkan." });

        const existing = db.prepare(`SELECT * FROM estimates WHERE id=? AND workshop_id=? LIMIT 1`).get(estimateId, workshopId);
        if (!existing) return res.status(404).json({ success:false, message:"Estimasi tidak ditemukan." });

        const tx = db.transaction(() => {
            const updateById = db.prepare(`
                UPDATE estimate_spareparts
                SET unit_price=?, discount=0, total_price=?
                WHERE id=? AND estimate_id=? AND workshop_id=? AND UPPER(TRIM(COALESCE(supply_bengkel,'BENGKEL')))='BENGKEL'
            `);
            const updateBySequence = db.prepare(`
                UPDATE estimate_spareparts
                SET unit_price=?, discount=0, total_price=?
                WHERE estimate_id=? AND sequence=? AND workshop_id=? AND UPPER(TRIM(COALESCE(supply_bengkel,'BENGKEL')))='BENGKEL'
            `);

            for (const item of items) {
                const raw = item?.net_sell_price;
                const value = raw === null || raw === undefined || String(raw).trim() === "" ? 0 : Number(raw);
                if (!Number.isFinite(value) || value < 0) {
                    throw new Error("Netto Harga Jual sparepart tidak valid.");
                }
                const netSell = Math.round((value + Number.EPSILON) * 100) / 100;
                const itemId = Number(item?.estimate_sparepart_id);
                let row = null;
                if (Number.isInteger(itemId) && itemId > 0) {
                    row = db.prepare(`SELECT id, quantity FROM estimate_spareparts WHERE id=? AND estimate_id=? AND workshop_id=? AND UPPER(TRIM(COALESCE(supply_bengkel,'BENGKEL')))='BENGKEL' LIMIT 1`).get(itemId, estimateId, workshopId);
                }
                if (row) {
                    updateById.run(netSell, Math.max(0, Number(row.quantity || 0) * netSell), row.id, estimateId, workshopId);
                } else {
                    const sequence = Number(item?.sequence);
                    if (!Number.isInteger(sequence) || sequence <= 0) continue;
                    row = db.prepare(`SELECT quantity FROM estimate_spareparts WHERE estimate_id=? AND sequence=? AND workshop_id=? AND UPPER(TRIM(COALESCE(supply_bengkel,'BENGKEL')))='BENGKEL' LIMIT 1`).get(estimateId, sequence, workshopId);
                    if (!row) continue;
                    updateBySequence.run(netSell, Math.max(0, Number(row.quantity || 0) * netSell), estimateId, sequence, workshopId);
                }
            }

            const spareparts = db.prepare(`SELECT part_name, part_number, quantity AS qty, unit, unit_price AS harga, discount AS diskon, total_price, sequence, supply_bengkel FROM estimate_spareparts WHERE estimate_id=? AND workshop_id=? ORDER BY sequence,id`).all(estimateId, workshopId);
            const jasa = db.prepare(`SELECT panel_name AS panel, service_type AS jenis, quantity AS qty, unit, unit_price AS harga, discount AS diskon FROM estimate_services WHERE estimate_id=? AND workshop_id=? ORDER BY sequence,id`).all(estimateId, workshopId);
            const jasaLain = db.prepare(`SELECT service_name AS nama, quantity AS qty, unit, unit_price AS harga, discount AS diskon FROM estimate_other_services WHERE estimate_id=? AND workshop_id=? ORDER BY sequence,id`).all(estimateId, workshopId);
            const hitung = hitungEstimasi({
                spareparts, jasa, jasa_lain:jasaLain,
                diskon:existing.discount,
                discount_sparepart_type:existing.discount_sparepart_type,
                discount_sparepart_value:existing.discount_sparepart_value,
                discount_jasa_type:existing.discount_jasa_type,
                discount_jasa_value:existing.discount_jasa_value,
                ppn_persen:existing.ppn_percent,
                ppn_type:existing.ppn_type,
                material_percent:existing.material_percent,
                own_risk:existing.own_risk
            });
            db.prepare(`
                UPDATE estimates SET subtotal_sparepart=?,discount_sparepart=?,total_sparepart=?,total_jasa=?,total_jasa_lain=?,subtotal=?,discount=?,total_after_discount=?,ppn_percent=?,ppn_type=?,ppn_amount=?,pph_percent=?,material_percent=?,labour_percent=?,labour_amount=?,pph_amount=?,own_risk=?,grand_total=?,total_billed=?,updated_at=CURRENT_TIMESTAMP
                WHERE id=? AND workshop_id=?
            `).run(
                hitung.subtotal_sparepart,hitung.discount_sparepart,hitung.total_sparepart,hitung.total_jasa,hitung.total_jasa_lain,hitung.subtotal,hitung.discount,hitung.total_after_discount,hitung.ppn_percent,hitung.ppn_type,hitung.ppn_amount,hitung.pph_percent,hitung.material_percent,hitung.labour_percent,hitung.labour_amount,hitung.pph_amount,hitung.own_risk,hitung.grand_total,hitung.total_billed,estimateId,workshopId
            );
        });
        tx();
        const saved = db.prepare(`SELECT total_sparepart, grand_total FROM estimates WHERE id=? AND workshop_id=?`).get(estimateId, workshopId);
        res.json({ success:true, message:"Netto Harga Jual sparepart BENGKEL berhasil disinkronkan ke Estimasi.", data:saved });
    } catch(error) {
        console.error("SYNC NETTO HARGA JUAL SPAREPART ERROR:", error);
        res.status(500).json({ success:false, message:error.message || "Gagal menyinkronkan Netto Harga Jual ke Estimasi." });
    }
});

// ============================================================
// HAPUS ESTIMASI
// ============================================================

// ============================================================
// UPDATE ESTIMASI
// ============================================================
app.put("/api/estimasi/:id", (req, res) => {
    try {
        const estimateId = Number(req.params.id);
        if (!idValid(estimateId)) return res.status(400).json({success:false,message:"ID estimasi tidak valid."});
        const body = req.body || {};
        const existing = db.prepare(`SELECT * FROM estimates WHERE id = ? AND workshop_id = ? LIMIT 1`).get(estimateId, Number(req.user?.workshop_id||0));
        if (!existing) return res.status(404).json({success:false,message:"Estimasi tidak ditemukan."});

        const spareparts = Array.isArray(body.spareparts) ? body.spareparts : [];
        const jasa = Array.isArray(body.jasa) ? body.jasa : [];
        const jasaLain = Array.isArray(body.jasa_lain) ? body.jasa_lain : (Array.isArray(body.jasaLain) ? body.jasaLain : []);
        const hitung = hitungEstimasi({spareparts,jasa,jasa_lain:jasaLain,diskon:body.diskon,discount_sparepart_type:body.discount_sparepart_type ?? body.discountSparepartType,discount_sparepart_value:body.discount_sparepart_value ?? body.discountSparepartValue,discount_jasa_type:body.discount_jasa_type ?? body.discountJasaType,discount_jasa_value:body.discount_jasa_value ?? body.discountJasaValue,ppn_persen:body.ppn_persen ?? body.ppnPercent,ppn_type:body.ppn_type ?? body.ppnType ?? body.ppn_dasar,material_percent:body.material_percent ?? body.materialPercent,own_risk:body.or ?? body.own_risk});
        let customerId = Number(body.customer_id) || Number(body.customerId) || Number(existing.customer_id) || 0;
        if (!customerId) return res.status(400).json({success:false,message:"Customer wajib dipilih."});
        const customer = db.prepare(`SELECT id FROM customers WHERE id = ? AND workshop_id = ?`).get(customerId, Number(req.user?.workshop_id||0));
        if (!customer) return res.status(400).json({success:false,message:"Customer tidak ditemukan."});

        const plate = teks(body.plate_number ?? body.plateNumber ?? body.plate).toUpperCase();
        if (!plate) return res.status(400).json({success:false,message:"Nomor polisi wajib diisi."});
        let vehicle = db.prepare(`SELECT id FROM vehicles WHERE customer_id = ? AND workshop_id = ? AND UPPER(plate_number)=UPPER(?) LIMIT 1`).get(customerId, Number(req.user?.workshop_id||0), plate);
        let vehicleId;
        if (vehicle) {
            vehicleId=Number(vehicle.id);
            db.prepare(`UPDATE vehicles SET brand=?,model=?,year=?,color=?,vin_number=?,engine_number=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workshop_id=?`).run(teks(body.brand),teks(body.model),body.year===""?null:Number(body.year)||null,teks(body.color),teks(body.vin_number ?? body.vin),teks(body.engine_number ?? body.engine),vehicleId,Number(req.user?.workshop_id||0));
        } else {
            const v=db.prepare(`INSERT INTO vehicles(customer_id,plate_number,brand,model,year,color,vin_number,engine_number,workshop_id) VALUES(?,?,?,?,?,?,?,?,?)`).run(customerId,plate,teks(body.brand),teks(body.model),body.year===""?null:Number(body.year)||null,teks(body.color),teks(body.vin_number ?? body.vin),teks(body.engine_number ?? body.engine));
            vehicleId=Number(v.lastInsertRowid);
        }
        let insurerId=Number(body.insurer_id) || null;
        if (insurerId && !db.prepare(`SELECT id FROM insurers WHERE id=? AND workshop_id=?`).get(insurerId, Number(req.user?.workshop_id||0))) insurerId=null;
        const status=["DRAFT","DIBUAT","APPROVED","CANCELLED","SELESAI"].includes(teks(body.status).toUpperCase()) ? teks(body.status).toUpperCase() : existing.status;

        const tx=db.transaction(()=>{
            db.prepare(`UPDATE estimates SET customer_id=?,vehicle_id=?,insurer_id=?,status=?,customer_note=?,subtotal_sparepart=?,discount_sparepart=?,discount_sparepart_type=?,discount_sparepart_value=?,discount_jasa_type=?,discount_jasa_value=?,total_sparepart=?,total_jasa=?,total_jasa_lain=?,subtotal=?,discount=?,total_after_discount=?,ppn_percent=?,ppn_type=?,ppn_amount=?,pph_percent=?,material_percent=?,labour_percent=?,labour_amount=?,pph_amount=?,own_risk=?,grand_total=?,total_billed=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workshop_id=?`).run(customerId,vehicleId,insurerId,status,teks(body.customer_note),hitung.subtotal_sparepart,hitung.discount_sparepart,hitung.discount_sparepart_type,hitung.discount_sparepart_value,hitung.discount_jasa_type,hitung.discount_jasa_value,hitung.total_sparepart,hitung.total_jasa,hitung.total_jasa_lain,hitung.subtotal,hitung.discount,hitung.total_after_discount,hitung.ppn_percent,hitung.ppn_type,hitung.ppn_amount,hitung.pph_percent,hitung.material_percent,hitung.labour_percent,hitung.labour_amount,hitung.pph_amount,hitung.own_risk,hitung.grand_total,hitung.total_billed,estimateId,Number(req.user?.workshop_id||0));
            // Simpan pilihan sumber Sparepart yang sudah ditentukan di WO/Estimasi.
            // Saat Estimasi direvisi, detail sparepart memang direbuild. Pilihan
            // SUPPLY/BENGKEL harus tetap melekat pada item yang sama, bukan sekadar
            // pada posisi/sequence. Sequence hanya digunakan sebagai fallback untuk
            // data lama yang tidak memiliki identitas item yang cukup.
            const existingSparepartRows = db.prepare(`
                SELECT id, sequence, part_name, part_number, quantity, unit, supply_bengkel
                FROM estimate_spareparts
                WHERE estimate_id=? AND workshop_id=?
                ORDER BY sequence ASC, id ASC
            `).all(estimateId,Number(req.user?.workshop_id||0));

            const normalizeSupply = value =>
                String(value || "BENGKEL").trim().toUpperCase() === "SUPPLY"
                    ? "SUPPLY"
                    : "BENGKEL";

            const normalizePartKey = (name, number) => {
                const n = teks(name).trim().toUpperCase();
                const p = teks(number).trim().toUpperCase();
                return `${p}\u001f${n}`;
            };

            const existingSupplyByKey = new Map();
            const existingSupplyBySequence = new Map();
            existingSparepartRows.forEach(row => {
                const supply = normalizeSupply(row.supply_bengkel);
                const key = normalizePartKey(row.part_name, row.part_number);
                // Jika nomor part tersedia, pasangan nomor+nama menjadi identitas utama.
                // Untuk data lama yang kosong, nama tetap dapat menjadi kunci fallback.
                if (key !== "\u001f") existingSupplyByKey.set(key, supply);
                if (teks(row.part_number).trim()) {
                    existingSupplyByKey.set(normalizePartKey("", row.part_number), supply);
                }
                if (teks(row.part_name).trim()) {
                    existingSupplyByKey.set(normalizePartKey(row.part_name, ""), supply);
                }
                existingSupplyBySequence.set(Number(row.sequence), supply);
            });

            db.prepare(`DELETE FROM estimate_spareparts WHERE estimate_id=? AND workshop_id=?`).run(estimateId,Number(req.user?.workshop_id||0));
            db.prepare(`DELETE FROM estimate_services WHERE estimate_id=? AND workshop_id=?`).run(estimateId,Number(req.user?.workshop_id||0));
            db.prepare(`DELETE FROM estimate_other_services WHERE estimate_id=? AND workshop_id=?`).run(estimateId,Number(req.user?.workshop_id||0));
            const isp=db.prepare(`INSERT INTO estimate_spareparts(estimate_id,part_name,part_number,quantity,unit,unit_price,discount,total_price,sequence,workshop_id,supply_bengkel) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
            spareparts.forEach((item,i)=>{
                const nama=teks(item.nama??item.name??item.part_name);
                const nomor=teks(item.sku??item.part_number);
                const qty=angka(item.qty??item.quantity);
                const harga=angka(item.harga??item.price??item.unit_price);
                const disk=angka(item.diskon??item.discount);
                const total=Math.max(0,qty*harga-disk);
                if(nama||nomor||qty||harga){
                    const sequence=i+1;
                    const incomingSupply = item?.supply_bengkel ?? item?.supplyBengkel ?? item?.supply;
                    const key = normalizePartKey(nama, nomor);

                    // Pilihan sumber yang sudah tersimpan di WO/Estimasi menjadi
                    // sumber kebenaran saat Estimasi direvisi. Nilai default
                    // BENGKEL dari frontend tidak boleh menimpa SUPPLY yang sudah dipilih.
                    const persistedSupply =
                        existingSupplyByKey.get(key)
                        ?? existingSupplyByKey.get(normalizePartKey("", nomor))
                        ?? existingSupplyByKey.get(normalizePartKey(nama, ""))
                        ?? existingSupplyBySequence.get(sequence);

                    const supply = persistedSupply !== undefined
                        ? normalizeSupply(persistedSupply)
                        : (incomingSupply !== undefined && incomingSupply !== null && String(incomingSupply).trim()
                            ? normalizeSupply(incomingSupply)
                            : "BENGKEL");
                    isp.run(estimateId,nama||"Sparepart",nomor||null,qty,teks(item.unit)||"PCS",harga,disk,total,sequence,Number(req.user?.workshop_id||0),supply);
                }
            });
            const ijs=db.prepare(`INSERT INTO estimate_services(estimate_id,panel_name,service_type,quantity,unit,unit_price,discount,total_price,sequence,workshop_id) VALUES(?,?,?,?,?,?,?,?,?,?)`);
            jasa.forEach((item,i)=>{const panel=teks(item.panel??item.panel_name),jenis=teks(item.jenis??item.service_type),qty=angka(item.qty??item.quantity??1),harga=angka(item.harga??item.jumlah??item.unit_price),disk=angka(item.diskon??item.discount),total=Math.max(0,qty*harga-disk);if(panel||jenis||harga)ijs.run(estimateId,panel||"Jasa Perbaikan / Pengecatan",jenis||"Service",qty,teks(item.unit)||"JOB",harga,disk,total,i+1,Number(req.user?.workshop_id||0));});
            const ijo=db.prepare(`INSERT INTO estimate_other_services(estimate_id,service_name,quantity,unit,unit_price,discount,total_price,sequence,workshop_id) VALUES(?,?,?,?,?,?,?,?,?)`);
            jasaLain.forEach((item,i)=>{const nama=teks(item.nama??item.service_name),qty=angka(item.qty??item.quantity??1),harga=angka(item.harga??item.jumlah??item.unit_price),disk=angka(item.diskon??item.discount),total=Math.max(0,qty*harga-disk);if(nama||harga)ijo.run(estimateId,nama||"Jasa Lain-lain",qty,teks(item.unit)||"JOB",harga,disk,total,i+1,Number(req.user?.workshop_id||0));});
        });
        tx();
        res.json({success:true,message:"Estimasi berhasil diperbarui.",data:{estimate_id:estimateId,estimate_number:existing.estimate_number,customer_id:customerId,vehicle_id:vehicleId,calculation:hitung}});
    } catch(error) {
        console.error("PUT ESTIMASI ERROR:",error);
        res.status(500).json({success:false,message:error.message||"Gagal memperbarui estimasi."});
    }
});

app.delete(
    "/api/estimasi/:id",
    (req, res) => {

        try {

            if (!requireDeleteManagerMaster(req, res)) return;

            const id =
                Number(
                    req.params.id
                );


            if (
                !idValid(id)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "ID estimasi tidak valid."

                    });
            }


            const estimasi =
                db.prepare(`
                    SELECT
                        e.id,
                        e.estimate_number,
                        c.name AS customer_name,
                        i.alias AS insurer_alias,
                        i.name AS insurer_name
                    FROM estimates e
                    INNER JOIN customers c ON c.id = e.customer_id AND c.workshop_id = e.workshop_id
                    LEFT JOIN insurers i ON i.id = e.insurer_id AND i.workshop_id = e.workshop_id
                    WHERE e.id = ? AND e.workshop_id = ?
                    LIMIT 1
                `).get(id, requestWorkshopId(req));


            if (!estimasi) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "Estimasi tidak ditemukan."

                    });
            }


            const reason = String(req.body?.reason || "").trim();
            if (!reason) {
                return res.status(400).json({
                    success: false,
                    message: "Alasan penghapusan Estimasi wajib diisi."
                });
            }

            const deletePassword = String(req.body?.password || "");
            if (!verifyConfiguredDeletePassword(req, "estimate", deletePassword)) {
                return res.status(403).json({
                    success: false,
                    message: "Password Hapus Estimasi salah atau belum diatur di User & Role."
                });
            }

            // Lepaskan terlebih dahulu referensi Mobil Masuk yang menunjuk
            // ke estimasi ini. FK mobil_masuk.used_estimate_id menggunakan
            // ON DELETE NO ACTION, sehingga estimasi tidak dapat dihapus
            // langsung walaupun password penghapusan benar.
            const clearEstimateReference = db.prepare(`
                UPDATE mobil_masuk
                SET used_estimate_id = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE used_estimate_id = ? AND workshop_id = ?
            `);

            const deleteEstimate = db.prepare(`
                DELETE FROM estimates
                WHERE id = ? AND workshop_id = ?
            `);

            const tx = db.transaction(() => {
                db.prepare(`
                    INSERT INTO deletion_history
                        (document_type, document_id, document_number, customer_name, insurer_alias, reason, deleted_by, workshop_id)
                    VALUES ('ESTIMASI', ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    id,
                    estimasi.estimate_number,
                    estimasi.customer_name || "-",
                    estimasi.insurer_alias || estimasi.insurer_name || "-",
                    reason,
                    auditUserId(req),
                    requestWorkshopId(req)
                );
                clearEstimateReference.run(id, requestWorkshopId(req));
                deleteEstimate.run(id, requestWorkshopId(req));
            });

            tx();


            res.json({

                success: true,

                message:
                    "Estimasi berhasil dihapus."

            });

        }

        catch (error) {

            console.error(
                "DELETE ESTIMASI ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal menghapus estimasi."

                });
        }
    }
);

// ============================================================
// WO - DAFTAR
// ============================================================

app.get(
    "/api/wo",
    (req, res) => {

        try {

            const data =
                db.prepare(`
                    SELECT

                        w.id,

                        w.wo_number,

                        w.estimate_id,

                        w.status,

                        w.target_date,

                        w.kilometer,

                        w.check_in_at,

                        w.pengerjaan_at,

                        w.selesai_at,

                        w.check_out_at,

                        w.notes,

                        w.completed_note,

                        w.created_by,

                        COALESCE(u.full_name, u.username) AS created_by_name,

                        u.username AS created_by_username,

                        w.created_at,

                        w.updated_at,

                        e.estimate_number,

                        e.estimate_date,

                        e.grand_total,

                        e.total_billed,

                        e.agent,

                        c.id AS customer_id,

                        c.customer_code,

                        c.name AS customer_name,

                        c.phone AS customer_phone,

                        i.id AS insurer_id,

                        i.code AS insurer_code,

                        i.name AS insurer_name,

                        i.alias AS insurer_alias,

                        tk.id AS kuitansi_id, tk.kuitansi_number,

                        tk.grand_total AS kuitansi_nominal,

                        tk.created_at AS kuitansi_created_at,

                        v.id AS vehicle_id,

                        v.plate_number,

                        v.brand,

                        v.model,

                        v.year,

                        v.color,

                        v.vin_number,

                        v.engine_number

                    FROM wo w

                    LEFT JOIN estimates e
                        ON w.estimate_id = e.id AND e.workshop_id = w.workshop_id

                    LEFT JOIN customers c
                        ON e.customer_id = c.id AND c.workshop_id = w.workshop_id

                    LEFT JOIN vehicles v
                        ON e.vehicle_id = v.id AND v.workshop_id = w.workshop_id

                    LEFT JOIN insurers i
                        ON e.insurer_id = i.id AND i.workshop_id = w.workshop_id

                    LEFT JOIN tagihan_kuitansi tk
                        ON tk.wo_id = w.id AND tk.workshop_id = w.workshop_id

                    LEFT JOIN users u
                        ON w.created_by =
                           u.id

                    WHERE w.workshop_id = ?
                    ORDER BY
                        w.id DESC
                `).all(Number(req.user?.workshop_id||0));

            // Detail sparepart selalu ikut dikirim bersama WO agar modul
            // Produksi, Permintaan Sparepart, Supply, Billing, dan Laporan
            // membaca sumber data yang sama dari database pusat.
            const sparepartStmt = db.prepare(`
                SELECT id, estimate_id, part_name, part_number, quantity, unit, unit_price, discount, total_price, sequence, supply_bengkel
                FROM estimate_spareparts
                WHERE estimate_id = ? AND workshop_id = ?
                ORDER BY sequence ASC, id ASC
            `);
            // Ringkasan status kedatangan sparepart untuk WO Aktif.
            // BENGKEL mengikuti item pada Purchase Order, sedangkan SUPPLY
            // mengikuti data penerimaan supply. Status hanya berdasarkan
            // kedatangan aktual, bukan sekadar PO dibuat.
            const readCentralStorageArray = (key) => {
                const row = db.prepare(`SELECT data_json FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`).get(key, Number(req.user?.workshop_id || 0));
                if (!row || !row.data_json) return [];
                try {
                    const parsed = JSON.parse(row.data_json);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (_) {
                    return [];
                }
            };
            const purchaseOrders = readCentralStorageArray("purchase_orders");
            const supplyArrivals = readCentralStorageArray("supply_arrivals");

            const sameId = (a, b) => String(a ?? "") === String(b ?? "") && String(a ?? "") !== "";
            const norm = value => String(value ?? "").trim().toUpperCase();
            const arrivalForBengkel = (woId, item, bengkelIndex) => {
                const po = purchaseOrders.find(x => String(x?.wo_id ?? x?.woId ?? "") === String(woId));
                const poItems = Array.isArray(po?.items) ? po.items : [];
                let entry = null;
                if (item?.id != null) {
                    entry = poItems.find(x => sameId(x?.item_id ?? x?.itemId, item.id));
                }
                if (!entry) entry = poItems[bengkelIndex] || null;
                if (!entry) {
                    const name = norm(item?.part_name ?? item?.partName ?? item?.name);
                    entry = poItems.find(x => norm(x?.name ?? x?.part_name ?? x?.partName) === name) || null;
                }
                return entry;
            };
            const arrivalForSupply = (woId, item, originalIndex) => {
                if (item?.id != null) {
                    const byId = supplyArrivals.find(x =>
                        String(x?.wo_id ?? x?.woId ?? "") === String(woId) &&
                        sameId(x?.item_id ?? x?.itemId, item.id)
                    );
                    if (byId) return byId;
                }
                return supplyArrivals.find(x =>
                    String(x?.wo_id ?? x?.woId ?? "") === String(woId) &&
                    Number(x?.item_index ?? x?.itemIndex) === Number(originalIndex)
                ) || null;
            };

            data.forEach(row => {
                row.spareparts = sparepartStmt.all(row.estimate_id, Number(req.user?.workshop_id||0));
                let bengkelIndex = 0;
                row.sparepart_status = row.spareparts.map((item, originalIndex) => {
                    const type = norm(item?.supply_bengkel ?? item?.supplyBengkel ?? item?.supply ?? "BENGKEL") === "SUPPLY" ? "SUPPLY" : "BENGKEL";
                    const arrival = type === "BENGKEL"
                        ? arrivalForBengkel(row.id, item, bengkelIndex++)
                        : arrivalForSupply(row.id, item, originalIndex);
                    const returned = !!arrival && (arrival.returned === true || String(arrival.return_status || arrival.status || "").trim().toUpperCase() === "RETURN");
                    const arrived = !returned && !!(arrival?.arrival_date || arrival?.arrived);
                    const returnHistory = Array.isArray(arrival?.return_history) ? arrival.return_history : [];
                    const replacementHistory = Array.isArray(arrival?.replacement_history) ? arrival.replacement_history : [];
                    const latestReturn = returnHistory.length ? returnHistory[returnHistory.length - 1] : null;
                    const latestReplacement = replacementHistory.length ? replacementHistory[replacementHistory.length - 1] : null;
                    const returnReason = returned
                        ? (arrival?.return_reason || latestReturn?.reason || null)
                        : null;
                    const supplier =
                        arrival?.supplier || arrival?.supplier_name || arrival?.supplierName ||
                        arrival?.vendor || arrival?.vendor_name || arrival?.vendorName ||
                        latestReturn?.supplier || latestReturn?.supplier_name || latestReturn?.supplierName ||
                        latestReplacement?.supplier || latestReplacement?.supplier_name || latestReplacement?.supplierName ||
                        null;
                    return {
                        id: item.id,
                        part_name: item.part_name,
                        part_number: item.part_number,
                        quantity: item.quantity,
                        unit: item.unit,
                        supply_bengkel: type,
                        arrived,
                        returned,
                        return_reason: returnReason,
                        return_history: returnHistory,
                        arrival_date: returned ? null : (arrival?.arrival_date || null),
                        supplier,
                        note: returned
                            ? (returnReason ? `RETURN: ${returnReason}` : (arrival?.note || arrival?.arrival_note || null))
                            : (arrival?.note || arrival?.arrival_note || null)
                    };
                });
                row.sparepart_summary = {
                    total: row.sparepart_status.length,
                    arrived: row.sparepart_status.filter(x => x.arrived).length,
                    returned: row.sparepart_status.filter(x => x.returned).length,
                    remaining: row.sparepart_status.filter(x => !x.arrived).length
                };
            });

            res.json({

                success: true,

                data:
                    data

            });

        }

        catch (error) {

            console.error(
                "GET WO ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal mengambil data WO."

                });

        }

    }
);

// ============================================================
// WO - KETERANGAN PROGRESS
// ============================================================

app.put(
    "/api/wo/:id/progress-note",
    (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!idValid(id)) return res.status(400).json({ success: false, message: "ID WO tidak valid." });
            const workshopId = requestWorkshopId(req);
            const existing = db.prepare(`SELECT * FROM wo WHERE id = ? AND workshop_id = ? LIMIT 1`).get(id, workshopId);
            if (!existing) return res.status(404).json({ success: false, message: "WO tidak ditemukan." });
            const note = teks(req.body?.keterangan ?? req.body?.note ?? "").trim();
            if (!note) return res.status(400).json({ success: false, message: "Keterangan Progress wajib diisi." });
            const oldNote = String(existing.progress_note || "");
            if (oldNote === note) return res.json({ success: true, message: "Tidak ada perubahan.", data: existing });
            const now = new Date().toISOString();
            db.prepare(`UPDATE wo SET progress_note = ?, updated_at = ? WHERE id = ? AND workshop_id = ?`).run(note, now, id, workshopId);
            // Catat hanya perubahan keterangan progress.
            db.prepare(`INSERT INTO wo_process_history (wo_id, cycle_no, status, note, changed_at, workshop_id)
                        VALUES (?, COALESCE((SELECT MAX(cycle_no) FROM wo_process_history WHERE wo_id = ? AND workshop_id = ?),1), 'KETERANGAN PROGRESS', ?, ?, ?)`)
              .run(id, id, workshopId, note, now, workshopId);
            const wo = db.prepare(`SELECT * FROM wo WHERE id = ? AND workshop_id = ?`).get(id, workshopId);
            res.json({ success: true, message: "Keterangan Progress berhasil disimpan.", data: wo });
        } catch (error) {
            console.error("SIMPAN KETERANGAN PROGRESS WO ERROR:", error);
            res.status(500).json({ success: false, message: error.message || "Gagal menyimpan Keterangan Progress." });
        }
    }
);

// ============================================================
// WO - KETERANGAN WO SELESAI
// ============================================================

app.put(
    "/api/wo/:id/completed-note",
    (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!idValid(id)) {
                return res.status(400).json({ success: false, message: "ID WO tidak valid." });
            }

            const workshopId = requestWorkshopId(req);
            const existing = db.prepare(`
                SELECT * FROM wo
                WHERE id = ? AND workshop_id = ?
                LIMIT 1
            `).get(id, workshopId);

            if (!existing) {
                return res.status(404).json({ success: false, message: "WO tidak ditemukan." });
            }

            if (String(existing.status || "").toUpperCase() !== "CHECK OUT") {
                return res.status(400).json({
                    success: false,
                    message: "Keterangan ini hanya dapat diinput pada WO yang sudah CHECK OUT."
                });
            }

            const note = teks(req.body?.note ?? req.body?.keterangan ?? "").trim();
            if (!note) {
                return res.status(400).json({ success: false, message: "Keterangan wajib diisi." });
            }

            const oldNote = String(existing.completed_note || "").trim();
            if (oldNote === note) {
                const data = db.prepare(`SELECT * FROM wo WHERE id = ? AND workshop_id = ?`).get(id, workshopId);
                return res.json({ success: true, message: "Tidak ada perubahan.", data });
            }

            const now = new Date().toISOString();
            db.prepare(`
                UPDATE wo
                SET completed_note = ?, updated_at = ?
                WHERE id = ? AND workshop_id = ?
            `).run(note, now, id, workshopId);

            recordWOHistory(id, "KETERANGAN WO SELESAI", note);

            const data = db.prepare(`SELECT * FROM wo WHERE id = ? AND workshop_id = ?`).get(id, workshopId);
            res.json({
                success: true,
                message: oldNote ? "Keterangan WO Selesai berhasil diperbarui." : "Keterangan WO Selesai berhasil disimpan.",
                data
            });
        } catch (error) {
            console.error("SIMPAN KETERANGAN WO SELESAI ERROR:", error);
            res.status(500).json({ success: false, message: error.message || "Gagal menyimpan Keterangan WO Selesai." });
        }
    }
);

// ============================================================
// WO - LAPORAN PROGRESS AKTIF
// ============================================================

app.get(
    "/api/wo/progress-report",
    (req, res) => {
        try {
            const rows = db.prepare(`
                SELECT
                    w.id,
                    w.wo_number,
                    w.status,
                    w.target_date,
                    w.check_in_at,
                    w.check_out_at,
                    w.kilometer,
                    w.notes,
                    w.progress_note,
                    w.created_at,
                    c.customer_code,
                    c.name AS customer_name,
                    v.plate_number,
                    v.brand,
                    v.model,
                    v.year,
                    v.color,
                    i.alias AS insurer_alias,
                    latest.cycle_no AS check_in_again_cycle,
                    latest.changed_at AS check_in_again_at,
                    latest.note AS check_in_again_note
                FROM wo w
                LEFT JOIN estimates e ON e.id = w.estimate_id
                LEFT JOIN customers c ON c.id = e.customer_id
                LEFT JOIN vehicles v ON v.id = e.vehicle_id
                LEFT JOIN insurers i ON i.id = e.insurer_id AND i.workshop_id = w.workshop_id
                LEFT JOIN wo_process_history latest
                    ON latest.id = (
                        SELECT h.id
                        FROM wo_process_history h
                        WHERE h.wo_id = w.id
                          AND UPPER(TRIM(h.status)) = 'CHECK IN AGAIN'
                        ORDER BY h.id DESC
                        LIMIT 1
                    )
                WHERE w.workshop_id = ?
                  AND UPPER(TRIM(COALESCE(w.status, 'CHECK IN'))) <> 'CHECK OUT'
                ORDER BY
                    CASE WHEN w.target_date IS NULL OR TRIM(w.target_date) = '' THEN 1 ELSE 0 END,
                    w.target_date ASC,
                    w.id ASC
            `).all(requestWorkshopId(req));

            res.json({
                success: true,
                count: rows.length,
                data: rows
            });
        } catch (error) {
            console.error("GET WO PROGRESS REPORT ERROR:", error);
            res.status(500).json({
                success: false,
                message: error.message || "Gagal mengambil Laporan Progress WO."
            });
        }
    }
);


// ============================================================
// WO - DETAIL
// ============================================================

app.get(
    "/api/wo/:id",
    (req, res) => {

        try {

            const id =
                Number(
                    req.params.id
                );


            if (
                !idValid(id)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "ID WO tidak valid."

                    });

            }


            const data =
                db.prepare(`
                    SELECT

                        w.*,

                        e.estimate_number,

                        e.estimate_date,

                        e.customer_id,

                        e.vehicle_id,

                        e.insurer_id,

                        e.agent,

                        e.customer_note,

                        e.subtotal_sparepart,

                        e.total_sparepart,

                        e.total_jasa,

                        e.total_jasa_lain,

                        e.subtotal,

                        e.discount,

                        e.total_after_discount,

                        e.ppn_percent,

                        e.ppn_type,

                        e.ppn_amount,

                        e.pph_percent,

                        e.labour_percent,

                        e.labour_amount,

                        e.pph_amount,

                        e.own_risk,

                        e.grand_total,

                        e.total_billed,

                        c.customer_code,

                        c.name AS customer_name,

                        c.phone AS customer_phone,

                        c.customer_type,

                        c.address AS customer_address,

                        c.notes AS customer_notes,

                        i.code AS insurer_code,

                        i.name AS insurer_name,

                        v.plate_number,

                        v.brand,

                        v.model,

                        v.year,

                        v.color,

                        v.vin_number,

                        v.engine_number,

                        v.notes AS vehicle_notes

                    FROM wo w

                    INNER JOIN estimates e
                        ON w.estimate_id =
                           e.id

                    INNER JOIN customers c
                        ON e.customer_id =
                           c.id

                    INNER JOIN vehicles v
                        ON e.vehicle_id =
                           v.id

                    LEFT JOIN insurers i
                        ON e.insurer_id = i.id AND i.workshop_id = w.workshop_id

                    WHERE
                        w.id = ?

                    LIMIT 1
                `).get(
                    id
                );


            if (!data) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            "WO tidak ditemukan."

                    });

            }


            const spareparts =
                db.prepare(`
                    SELECT

                        id,

                        part_name,

                        part_number,

                        quantity,

                        unit,

                        sequence,

                        supply_bengkel

                    FROM estimate_spareparts

                    WHERE estimate_id = ? AND workshop_id = ?

                    ORDER BY sequence, id
                `).all(
                    data.estimate_id, requestWorkshopId(req)
                );


            const jasa =
                db.prepare(`
                    SELECT

                        id,

                        panel_name,

                        service_type,

                        quantity,

                        unit,

                        sequence

                    FROM estimate_services

                    WHERE estimate_id = ? AND workshop_id = ?

                    ORDER BY sequence, id
                `).all(
                    data.estimate_id, requestWorkshopId(req)
                );


            const jasaLain =
                db.prepare(`
                    SELECT

                        id,

                        service_name,

                        quantity,

                        unit,

                        sequence

                    FROM estimate_other_services

                    WHERE estimate_id = ? AND workshop_id = ?

                    ORDER BY sequence, id
                `).all(
                    data.estimate_id, requestWorkshopId(req)
                );


            res.json({

                success: true,

                data: {

                    wo:
                        data,

                    spareparts:
                        spareparts,

                    jasa:
                        jasa,

                    jasa_lain:
                        jasaLain

                }

            });

        }

        catch (error) {

            console.error(
                "GET WO DETAIL ERROR:",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Gagal mengambil detail WO."

                });

        }

    }
);


// ============================================================
// WO - BUAT DARI ESTIMASI
// ============================================================

app.post(
    "/api/wo",
    (req, res) => {

        try {

            const estimateId =
                Number(req.body.estimate_id);

            if (!idValid(estimateId)) {
                return res.status(400).json({
                    success: false,
                    message: "ID estimasi tidak valid."
                });
            }

            const estimasi =
                db.prepare(`
                    SELECT id, estimate_number
                    FROM estimates
                    WHERE id = ? AND workshop_id = ?
                    LIMIT 1
                `).get(estimateId, requestWorkshopId(req));

            if (!estimasi) {
                return res.status(404).json({
                    success: false,
                    message: "Estimasi tidak ditemukan."
                });
            }

            const sudahAda =
                db.prepare(`
                    SELECT id, wo_number, status
                    FROM wo
                    WHERE estimate_id = ? AND workshop_id = ?
                    LIMIT 1
                `).get(estimateId, requestWorkshopId(req));

            if (sudahAda) {
                return res.status(409).json({
                    success: false,
                    message:
                        `Estimasi ${estimasi.estimate_number} sudah memiliki WO ${sudahAda.wo_number}.`,
                    data: sudahAda
                });
            }

            const woNumber =
                generateWONumber(req.user?.workshop_id);

            const notes =
                teks(req.body.notes);

            // Pembuat WO wajib mengikuti user login yang melakukan pembuatan WO.
            const createdBy = auditUserId(req);

            if (!createdBy) {
                return res.status(400).json({
                    success: false,
                    message: "User pembuat WO tidak ditemukan. Silakan login ulang sebelum membuat WO."
                });
            }

            const pembuatWO = db.prepare(`
                SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1
            `).get(createdBy);

            if (!pembuatWO) {
                return res.status(400).json({
                    success: false,
                    message: "User pembuat WO tidak valid atau tidak aktif."
                });
            }

            const hasil =
                db.prepare(`
                    INSERT INTO wo
                    (
                        wo_number,
                        estimate_id,
                        status,
                        target_date,
                        notes,
                        kilometer,
                        created_by,
                        workshop_id
                    )
                    VALUES (?, ?, 'CHECK IN', ?, ?, ?, ?, ?)
                `).run(
                    woNumber,
                    estimateId,
                    teks(req.body.target_date) || null,
                    notes,
                    req.body.kilometer === "" || req.body.kilometer === null || req.body.kilometer === undefined
                        ? null
                        : angka(req.body.kilometer),
                    createdBy,
                    Number(req.user?.workshop_id||0)
                );

            recordWOHistory(hasil.lastInsertRowid, "CHECK IN");

            const wo =
                db.prepare(`
                    SELECT *
                    FROM wo
                    WHERE id = ? AND workshop_id = ?
                `).get(
                    hasil.lastInsertRowid, requestWorkshopId(req)
                );

            res.status(201).json({
                success: true,
                message: "WO berhasil dibuat dari Estimasi.",
                data: wo
            });

        }
        catch (error) {

            console.error(
                "POST WO ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    error.message ||
                    "Gagal membuat WO dari Estimasi."
            });
        }
    }
);


// ============================================================
// WO - EDIT DATA CHECK IN
// ============================================================

app.put(
    "/api/wo/:id",
    (req, res) => {

        try {

            const id =
                Number(req.params.id);

            if (!idValid(id)) {
                return res.status(400).json({
                    success: false,
                    message: "ID WO tidak valid."
                });
            }

            const existing =
                db.prepare(`
                    SELECT
                        w.*,
                        e.estimate_number,
                        c.name AS customer_name,
                        i.alias AS insurer_alias,
                        i.name AS insurer_name
                    FROM wo w
                    INNER JOIN estimates e ON e.id = w.estimate_id AND e.workshop_id = w.workshop_id
                    INNER JOIN customers c ON c.id = e.customer_id AND c.workshop_id = w.workshop_id
                    LEFT JOIN insurers i ON i.id = e.insurer_id AND i.workshop_id = w.workshop_id
                    WHERE w.id = ? AND w.workshop_id = ?
                    LIMIT 1
                `).get(id, requestWorkshopId(req));

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: "WO tidak ditemukan."
                });
            }

            const kilometer =
                req.body.kilometer === "" ||
                req.body.kilometer === null ||
                req.body.kilometer === undefined
                    ? null
                    : angka(req.body.kilometer);

            const notes =
                req.body.notes !== undefined
                    ? teks(req.body.notes)
                    : existing.notes;

            const targetDate =
                req.body.target_date !== undefined
                    ? (teks(req.body.target_date) || null)
                    : existing.target_date;

            db.prepare(`
                UPDATE wo
                SET
                    kilometer = ?,
                    target_date = ?,
                    notes = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND workshop_id = ?
            `).run(
                kilometer,
                targetDate,
                notes,
                id,
                requestWorkshopId(req)
            );

            // Persist pilihan sumber Sparepart / Material dari WO.
            if (Array.isArray(req.body.spareparts)) {
                const updateById = db.prepare(`
                    UPDATE estimate_spareparts
                    SET supply_bengkel = ?
                    WHERE id = ? AND estimate_id = ? AND workshop_id = ?
                `);
                const updateBySequence = db.prepare(`
                    UPDATE estimate_spareparts
                    SET supply_bengkel = ?
                    WHERE estimate_id = ? AND sequence = ? AND workshop_id = ?
                `);
                req.body.spareparts.forEach((item, index) => {
                    const rawSupply = item?.supply_bengkel ?? item?.supplyBengkel ?? item?.supply;
                    // Jangan mengubah nilai yang sudah tersimpan jika frontend tidak mengirim pilihan sumber.
                    if (rawSupply === undefined || rawSupply === null || String(rawSupply).trim() === "") return;
                    const supply = String(rawSupply).trim().toUpperCase() === "SUPPLY" ? "SUPPLY" : "BENGKEL";
                    const itemId = Number(item?.id);
                    if (Number.isInteger(itemId) && itemId > 0) {
                        const result = updateById.run(supply, itemId, existing.estimate_id, requestWorkshopId(req));
                        if (!result.changes) updateBySequence.run(supply, existing.estimate_id, Number(item?.sequence ?? index + 1), requestWorkshopId(req));
                    } else {
                        updateBySequence.run(supply, existing.estimate_id, Number(item?.sequence ?? index + 1), requestWorkshopId(req));
                    }
                });
            }

            const wo =
                db.prepare(`
                    SELECT *
                    FROM wo
                    WHERE id = ? AND workshop_id = ?
                `).get(id, requestWorkshopId(req));

            res.json({
                success: true,
                message: "WO berhasil diperbarui.",
                data: wo
            });

        }
        catch (error) {

            console.error(
                "PUT WO ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    error.message ||
                    "Gagal memperbarui WO."
            });
        }
    }
);


// ============================================================
// WO - CHECK IN
// ============================================================

app.put(
    "/api/wo/:id/check-in",
    (req, res) => {

        try {

            const id =
                Number(req.params.id);

            if (!idValid(id)) {
                return res.status(400).json({
                    success: false,
                    message: "ID WO tidak valid."
                });
            }

            const existing =
                db.prepare(`
                    SELECT *
                    FROM wo
                    WHERE id = ? AND workshop_id = ?
                    LIMIT 1
                `).get(id, requestWorkshopId(req));

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: "WO tidak ditemukan."
                });
            }

            const kilometer =
                req.body.kilometer === "" ||
                req.body.kilometer === null ||
                req.body.kilometer === undefined
                    ? null
                    : angka(req.body.kilometer);

            db.prepare(`
                UPDATE wo
                SET
                    status = 'PENGERJAAN',
                    kilometer = ?,
                    check_in_at =
                        COALESCE(
                            check_in_at,
                            CURRENT_TIMESTAMP
                        ),
                    pengerjaan_at =
                        COALESCE(
                            pengerjaan_at,
                            CURRENT_TIMESTAMP
                        ),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND workshop_id = ?
            `).run(
                kilometer,
                id,
                requestWorkshopId(req)
            );

            const wo =
                db.prepare(`
                    SELECT *
                    FROM wo
                    WHERE id = ? AND workshop_id = ?
                `).get(id, requestWorkshopId(req));

            res.json({
                success: true,
                message: "WO berhasil CHECK IN dan masuk PENGERJAAN.",
                data: wo
            });

        }
        catch (error) {

            console.error(
                "CHECK IN WO ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    error.message ||
                    "Gagal CHECK IN WO."
            });
        }
    }
);


// ============================================================
// WO - SELESAI
// ============================================================

app.put(
    "/api/wo/:id/selesai",
    (req, res) => {

        try {

            const id =
                Number(req.params.id);

            if (!idValid(id)) {
                return res.status(400).json({
                    success: false,
                    message: "ID WO tidak valid."
                });
            }

            const existing =
                db.prepare(`
                    SELECT *
                    FROM wo
                    WHERE id = ? AND workshop_id = ?
                    LIMIT 1
                `).get(id, requestWorkshopId(req));

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: "WO tidak ditemukan."
                });
            }

            db.prepare(`
                UPDATE wo
                SET
                    status = 'SELESAI',
                    selesai_at =
                        COALESCE(
                            selesai_at,
                            CURRENT_TIMESTAMP
                        ),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND workshop_id = ?
            `).run(id, requestWorkshopId(req));

            const wo =
                db.prepare(`
                    SELECT *
                    FROM wo
                    WHERE id = ? AND workshop_id = ?
                `).get(id, requestWorkshopId(req));

            res.json({
                success: true,
                message: "WO ditandai SELESAI.",
                data: wo
            });

        }
        catch (error) {

            console.error(
                "SELESAI WO ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    error.message ||
                    "Gagal menyelesaikan WO."
            });
        }
    }
);


// ============================================================
// WO - CHECK OUT
// ============================================================

app.put(
    "/api/wo/:id/check-out",
    (req, res) => {

        try {

            const id =
                Number(req.params.id);

            if (!idValid(id)) {
                return res.status(400).json({
                    success: false,
                    message: "ID WO tidak valid."
                });
            }

            const existing =
                db.prepare(`
                    SELECT *
                    FROM wo
                    WHERE id = ? AND workshop_id = ?
                    LIMIT 1
                `).get(id, requestWorkshopId(req));

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: "WO tidak ditemukan."
                });
            }

            const note = String(req.body.note ?? req.body.keterangan ?? req.body.notes ?? '').trim();
            if (!note) {
                return res.status(400).json({
                    success: false,
                    message: "Isi Keterangan saat Check Out wajib diisi."
                });
            }

            db.prepare(`
                UPDATE wo
                SET
                    status = 'CHECK OUT',
                    check_out_at =
                        COALESCE(
                            check_out_at,
                            CURRENT_TIMESTAMP
                        ),
                    notes = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND workshop_id = ?
            `).run(note, id, requestWorkshopId(req));

            recordWOHistory(id, "CHECK OUT", note);

            const wo =
                db.prepare(`
                    SELECT *
                    FROM wo
                    WHERE id = ? AND workshop_id = ?
                `).get(id, requestWorkshopId(req));

            res.json({
                success: true,
                message: "WO berhasil CHECK OUT.",
                data: wo
            });

        }
        catch (error) {

            console.error(
                "CHECK OUT WO ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    error.message ||
                    "Gagal CHECK OUT WO."
            });
        }
    }
);


// ============================================================
// WO - UBAH STATUS ALUR PRODUKSI
// ============================================================

app.put(
    "/api/wo/:id/status",
    (req, res) => {

        try {

            const id = Number(req.params.id);
            if (!idValid(id)) {
                return res.status(400).json({
                    success: false,
                    message: "ID WO tidak valid."
                });
            }

            const allowed = [
                "CHECK IN",
                "BONGKAR",
                "DEMPUL",
                "CAT",
                "FINISHING",
                "SELESAI",
                "CHECK OUT"
            ];

            const status = String(req.body.status || "").toUpperCase();
            if (!allowed.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Status WO tidak valid."
                });
            }

            const existing = db.prepare(`SELECT * FROM wo WHERE id = ? AND workshop_id = ? LIMIT 1`).get(id, requestWorkshopId(req));
            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: "WO tidak ditemukan."
                });
            }

            const current = String(existing.status || "CHECK IN").toUpperCase() === "PENGERJAAN"
                ? "BONGKAR"
                : String(existing.status || "CHECK IN").toUpperCase();

            const nextMap = {
                "CHECK IN": "BONGKAR",
                "BONGKAR": "DEMPUL",
                "DEMPUL": "CAT",
                "CAT": "FINISHING",
                "FINISHING": "SELESAI",
                "SELESAI": "CHECK OUT"
            };

            if (nextMap[current] !== status) {
                return res.status(400).json({
                    success: false,
                    message: `Status berikutnya dari ${current} adalah ${nextMap[current] || "-"}.`
                });
            }

            const now = new Date().toISOString();
            const sets = ["status = ?", "updated_at = ?"];
            const values = [status, now];

            // Simpan Kilometer yang dikirim saat perubahan status.
            // Sebelumnya nilai Kilometer hanya berubah di frontend sehingga hilang
            // setelah refresh ketika diisi pada saat CHECK IN/BONGKAR.
            if (req.body.kilometer !== undefined) {
                const kilometer =
                    req.body.kilometer === "" ||
                    req.body.kilometer === null
                        ? null
                        : angka(req.body.kilometer);
                sets.push("kilometer = ?");
                values.push(kilometer);
            }

            if (status === "BONGKAR") {
                sets.push("check_in_at = COALESCE(check_in_at, ?)");
                values.push(now);
                sets.push("pengerjaan_at = COALESCE(pengerjaan_at, ?)");
                values.push(now);
            }
            if (status === "DEMPUL") {
                sets.push("dempul_at = ?");
                values.push(now);
            }
            if (status === "CAT") {
                sets.push("cat_at = ?");
                values.push(now);
            }
            if (status === "FINISHING") {
                sets.push("finishing_at = ?");
                values.push(now);
            }
            if (status === "SELESAI") {
                sets.push("selesai_at = COALESCE(selesai_at, ?)");
                values.push(now);
            }
            if (status === "CHECK OUT") {
                sets.push("check_out_at = COALESCE(check_out_at, ?)");
                values.push(now);
                sets.push("first_check_out_at = COALESCE(first_check_out_at, ?)");
                values.push(now);
            }

            // Kolom tahap tambahan dibuat aman jika belum tersedia.
            const columns = db.prepare(`PRAGMA table_info(wo)`).all().map(c => c.name);
            const extraColumns = ["dempul_at", "cat_at", "finishing_at"];
            for (const col of extraColumns) {
                if (!columns.includes(col)) {
                    try {
                        db.exec(`ALTER TABLE wo ADD COLUMN ${col} TEXT`);
                    } catch (_) {}
                }
            }

            db.prepare(`UPDATE wo SET ${sets.join(", ")} WHERE id = ? AND workshop_id = ?`).run(...values, id, requestWorkshopId(req));
            recordWOHistory(id, status, req.body.note || null);
            const wo = db.prepare(`SELECT * FROM wo WHERE id = ? AND workshop_id = ?`).get(id, requestWorkshopId(req));

            return res.json({
                success: true,
                message: `WO berhasil menjadi ${status}.`,
                data: wo
            });

        } catch (error) {

            console.error("UBAH STATUS WO ERROR:", error);

            return res.status(500).json({
                success: false,
                message: error.message || "Gagal mengubah status WO."
            });
        }
    }
);


// ============================================================
// DASHBOARD - RINGKASAN NILAI BILLING (MANAGER MASTER / BILLING)
// ============================================================
app.get("/api/dashboard/billing-summary", (req, res) => {
    try {
        const roleCode = String(req.user?.role?.code || req.user?.role_code || "").trim().toUpperCase();
        const roleName = String(req.user?.role?.name || req.user?.role_name || "").trim().toUpperCase();
        const allowed = roleCode === "MANAGER_MASTER" || roleCode === "BILLING" ||
            roleName === "MANAGER MASTER" || roleName === "BILLING";
        if (!allowed) return res.status(403).json({ success: false, message: "Akses tidak diizinkan." });

        const workshopId = Number(req.user?.workshop_id || 0);
        const currentYear = new Date().getFullYear();
        const monthNames = [
            "Januari", "Februari", "Maret", "April", "Mei", "Juni",
            "Juli", "Agustus", "September", "Oktober", "November", "Desember"
        ];

        const orRows = db.prepare(`
            SELECT CAST(strftime('%m', paid_at) AS INTEGER) AS month,
                   COALESCE(SUM(amount), 0) AS total
            FROM own_risk_payments
            WHERE workshop_id = ?
              AND strftime('%Y', paid_at) = ?
            GROUP BY strftime('%m', paid_at)
            ORDER BY month
        `).all(workshopId, String(currentYear));

        const tagihanRows = db.prepare(`
            SELECT CAST(strftime('%m', tk.created_at) AS INTEGER) AS month,
                   COALESCE(SUM(tk.grand_total), 0) AS total,
                   COALESCE(SUM(CASE WHEN pk.id IS NOT NULL THEN tk.grand_total ELSE 0 END), 0) AS paid_total,
                   COALESCE(SUM(CASE WHEN pk.id IS NULL THEN tk.grand_total ELSE 0 END), 0) AS unpaid_total
            FROM tagihan_kuitansi tk
            LEFT JOIN pembayaran_kuitansi pk
              ON pk.wo_id = tk.wo_id
             AND pk.workshop_id = tk.workshop_id
            WHERE tk.workshop_id = ?
              AND strftime('%Y', tk.created_at) = ?
            GROUP BY strftime('%m', tk.created_at)
            ORDER BY month
        `).all(workshopId, String(currentYear));

        const byMonth = new Map();
        for (let month = 1; month <= 12; month++) {
            byMonth.set(month, {
                month,
                label: monthNames[month - 1],
                or_paid: 0,
                tagihan_dibuat: 0,
                paid: 0,
                unpaid: 0
            });
        }
        orRows.forEach(row => {
            const month = Number(row.month);
            if (byMonth.has(month)) byMonth.get(month).or_paid = Math.max(0, Number(row.total) || 0);
        });
        tagihanRows.forEach(row => {
            const month = Number(row.month);
            if (byMonth.has(month)) {
                const target = byMonth.get(month);
                target.tagihan_dibuat = Math.max(0, Number(row.total) || 0);
                target.paid = Math.max(0, Number(row.paid_total) || 0);
                target.unpaid = Math.max(0, Number(row.unpaid_total) || 0);
            }
        });

        res.json({
            success: true,
            data: {
                year: currentYear,
                months: Array.from(byMonth.values())
            }
        });
    } catch (error) {
        console.error("GET DASHBOARD BILLING SUMMARY ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil ringkasan nilai billing." });
    }
});

// ============================================================
// DASHBOARD - CHECK IN AGAIN AKTIF
// ============================================================
app.get(
    "/api/dashboard/check-in-again",
    (req, res) => {
        try {
            const rows = db.prepare(`
                SELECT
                    h.id,
                    h.wo_id,
                    h.cycle_no,
                    h.changed_at,
                    h.note,
                    w.wo_number,
                    w.status AS wo_status,
                    c.name AS customer_name,
                    v.brand,
                    v.model,
                    v.plate_number
                FROM wo_process_history h
                INNER JOIN wo w ON w.id = h.wo_id
                INNER JOIN estimates e ON e.id = w.estimate_id
                INNER JOIN customers c ON c.id = e.customer_id
                INNER JOIN vehicles v ON v.id = e.vehicle_id
                WHERE w.workshop_id = ? AND UPPER(TRIM(h.status)) = 'CHECK IN AGAIN'
                  AND h.id = (
                      SELECT MAX(h2.id)
                      FROM wo_process_history h2
                      WHERE h2.wo_id = h.wo_id
                        AND UPPER(TRIM(h2.status)) = 'CHECK IN AGAIN'
                  )
                  AND NOT EXISTS (
                      SELECT 1
                      FROM wo_process_history hx
                      WHERE hx.wo_id = h.wo_id
                        AND UPPER(TRIM(hx.status)) = 'CHECK OUT'
                        AND hx.id > h.id
                  )
                ORDER BY h.id DESC
            `).all(requestWorkshopId(req));

            res.json({
                success: true,
                data: rows
            });
        } catch (error) {
            console.error("GET DASHBOARD CHECK IN AGAIN ERROR:", error);
            res.status(500).json({
                success: false,
                message: error.message || "Gagal mengambil data Check In Again aktif."
            });
        }
    }
);


// ============================================================
// WO - RIWAYAT PROSES
// ============================================================

app.get(
    "/api/wo/:id/history",
    (req, res) => {

        try {
            const id = Number(req.params.id);
            if (!idValid(id)) {
                return res.status(400).json({ success: false, message: "ID WO tidak valid." });
            }

            const wo = db.prepare(`SELECT id, wo_number, status FROM wo WHERE id = ? AND workshop_id = ? LIMIT 1`).get(id, requestWorkshopId(req));
            if (!wo) {
                return res.status(404).json({ success: false, message: "WO tidak ditemukan." });
            }

            let history = db.prepare(`
                SELECT id, wo_id, cycle_no, status, note, changed_at
                FROM wo_process_history
                WHERE wo_id = ? AND workshop_id = ?
                ORDER BY id ASC
            `).all(id, requestWorkshopId(req));

            // Kompatibilitas WO lama yang dibuat sebelum tabel riwayat tersedia.
            if (!history.length) {
                const legacy = db.prepare(`SELECT * FROM wo WHERE id = ? AND workshop_id = ? LIMIT 1`).get(id, requestWorkshopId(req));
                const fallback = [];
                const push = (status, value, note = null) => {
                    if (value) fallback.push({ id: `legacy-${status}`, wo_id: id, cycle_no: 1, status, note, changed_at: value });
                };
                push("CHECK IN", legacy.check_in_at);
                push("BONGKAR", legacy.pengerjaan_at);
                push("DEMPUL", legacy.dempul_at);
                push("CAT", legacy.cat_at);
                push("FINISHING", legacy.finishing_at);
                push("SELESAI", legacy.selesai_at);
                push("CHECK OUT", legacy.check_out_at);
                history = fallback;
            }

            res.json({ success: true, data: { wo, history } });
        } catch (error) {
            console.error("GET WO HISTORY ERROR:", error);
            res.status(500).json({ success: false, message: error.message || "Gagal mengambil riwayat WO." });
        }
    }
);


// ============================================================
// WO - CHECK IN AGAIN
// Dari WO status CHECK OUT kembali ke CHECK IN.
// ============================================================

app.post(
    "/api/wo/:id/check-in-again",
    (req, res) => {

        try {
            const id = Number(req.params.id);
            if (!idValid(id)) {
                return res.status(400).json({ success: false, message: "ID WO tidak valid." });
            }

            const existing = db.prepare(`SELECT * FROM wo WHERE id = ? AND workshop_id = ? LIMIT 1`).get(id, requestWorkshopId(req));
            if (!existing) {
                return res.status(404).json({ success: false, message: "WO tidak ditemukan." });
            }

            const current = String(existing.status || "").toUpperCase();
            if (current !== "CHECK OUT") {
                return res.status(400).json({ success: false, message: "Check In Again hanya dapat dilakukan pada WO status CHECK OUT." });
            }

            const note = teks(req.body.note || req.body.keterangan);
            if (!note) {
                return res.status(400).json({ success: false, message: "Keterangan Check In Again wajib diisi." });
            }

            const maxCycle = Number(db.prepare(`
                SELECT COALESCE(MAX(cycle_no), 1) AS max_cycle
                FROM wo_process_history
                WHERE wo_id = ? AND workshop_id = ?
            `).get(id, requestWorkshopId(req))?.max_cycle || 1);
            const nextCycle = Math.max(2, maxCycle + 1);
            const now = new Date().toISOString();

            db.prepare(`
                INSERT INTO wo_process_history
                (wo_id, cycle_no, status, note, changed_at, workshop_id)
                VALUES (?, ?, 'CHECK IN AGAIN', ?, ?, ?)
            `).run(id, nextCycle, note, now, requestWorkshopId(req));

            db.prepare(`
                UPDATE wo
                SET
                    status = 'CHECK IN',
                    check_in_at = ?,
                    pengerjaan_at = NULL,
                    dempul_at = NULL,
                    cat_at = NULL,
                    finishing_at = NULL,
                    selesai_at = NULL,
                    check_out_at = NULL,
                    updated_at = ?
                WHERE id = ? AND workshop_id = ?
            `).run(now, now, id, requestWorkshopId(req));

            db.prepare(`
                INSERT INTO wo_process_history
                (wo_id, cycle_no, status, note, changed_at, workshop_id)
                VALUES (?, ?, 'CHECK IN', ?, ?, ?)
            `).run(id, nextCycle, "Memulai ulang proses setelah Check In Again.", now, requestWorkshopId(req));

            const wo = db.prepare(`SELECT * FROM wo WHERE id = ? AND workshop_id = ?`).get(id, requestWorkshopId(req));
            res.json({ success: true, message: "WO berhasil Check In Again dan kembali ke proses WO.", data: wo });
        } catch (error) {
            console.error("CHECK IN AGAIN WO ERROR:", error);
            res.status(500).json({ success: false, message: error.message || "Gagal melakukan Check In Again." });
        }
    }
);


// ============================================================
// WO - HAPUS
// ============================================================

app.delete(
    "/api/wo/:id",
    (req, res) => {

        try {

            if (!requireDeleteManagerMaster(req, res)) return;

            const id =
                Number(req.params.id);

            if (!idValid(id)) {
                return res.status(400).json({
                    success: false,
                    message: "ID WO tidak valid."
                });
            }

            const existing =
                db.prepare(`
                    SELECT *
                    FROM wo
                    WHERE id = ? AND workshop_id = ?
                    LIMIT 1
                `).get(id, requestWorkshopId(req));

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: "WO tidak ditemukan."
                });
            }

            const reason = String(req.body?.reason || "").trim();
            if (!reason) {
                return res.status(400).json({
                    success: false,
                    message: "Alasan penghapusan WO wajib diisi."
                });
            }

            const deletePassword = String(req.body?.password || "");
            if (!verifyConfiguredDeletePassword(req, "wo", deletePassword)) {
                return res.status(403).json({
                    success: false,
                    message: "Password Hapus WO salah atau belum diatur di User & Role."
                });
            }

            const tx = db.transaction(() => {
                db.prepare(`
                    INSERT INTO deletion_history
                        (document_type, document_id, document_number, customer_name, insurer_alias, reason, deleted_by, workshop_id)
                    VALUES ('WO', ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    id,
                    existing.wo_number,
                    existing.customer_name || "-",
                    existing.insurer_alias || existing.insurer_name || "-",
                    reason,
                    auditUserId(req),
                    requestWorkshopId(req)
                );
                db.prepare(`
                    DELETE FROM wo
                    WHERE id = ? AND workshop_id = ?
                `).run(id, requestWorkshopId(req));
            });
            tx();

            res.json({
                success: true,
                message: "WO berhasil dihapus."
            });

        }
        catch (error) {

            console.error(
                "DELETE WO ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    error.message ||
                    "Gagal menghapus WO."
            });
        }
    }
);


// ============================================================
// LAPORAN
// Semua tanggal laporan menggunakan waktu Indonesia (WIB, UTC+7).
// user_id untuk laporan operasional = user pembuat WO.
// ============================================================

function validReportRange(req, res) {
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const userId = req.query.user_id === undefined || req.query.user_id === ""
        ? null
        : Number(req.query.user_id);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        res.status(400).json({ success: false, message: "Rentang tanggal wajib diisi dengan format yang benar." });
        return null;
    }
    if (from > to) {
        res.status(400).json({ success: false, message: "Dari tanggal tidak boleh lebih besar dari sampai tanggal." });
        return null;
    }
    if (userId !== null && !idValid(userId)) {
        res.status(400).json({ success: false, message: "User laporan tidak valid." });
        return null;
    }
    return { from, to, userId };
}

app.get("/api/laporan/users", (req, res) => {
    try {
        // Daftar user yang pernah membuat WO, dipakai oleh filter User WO
        // pada Laporan Mobil Masuk, Mobil Keluar, dan Outstanding WO.
        const data = db.prepare(`
            SELECT DISTINCT
                u.id,
                u.username,
                u.full_name
            FROM users u
            INNER JOIN wo w ON w.created_by = u.id AND w.workshop_id = ?
            ORDER BY
                LOWER(COALESCE(u.full_name, u.username, '')) ASC,
                u.id ASC
        `).all(requestWorkshopId(req));
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET LAPORAN USERS ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil daftar User WO." });
    }
});

// ============================================================
// MOBIL MASUK
// ============================================================
app.get("/api/mobil-masuk", (req, res) => {
    try {
        const data = db.prepare(`
            SELECT id, plate_number, brand, model, color, created_by,
                   used_estimate_id, used_at, created_at, updated_at
            FROM mobil_masuk
            WHERE workshop_id = ?
              AND used_at IS NULL
              AND used_estimate_id IS NULL
            ORDER BY id DESC
        `).all(requestWorkshopId(req));
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET MOBIL MASUK ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil data Mobil Masuk." });
    }
});

app.post("/api/mobil-masuk", (req, res) => {
    try {
        const plate = String(req.body?.plate_number || "").trim();
        const brand = String(req.body?.brand || "").trim();
        const model = String(req.body?.model || "").trim();
        const color = String(req.body?.color || "").trim();
        if (!plate || !brand || !model || !color) {
            return res.status(400).json({ success: false, message: "No. Polisi, Merek, Type, dan Warna wajib diisi." });
        }
        const createdBy = auditUserId(req);
        const result = db.prepare(`
            INSERT INTO mobil_masuk (plate_number, brand, model, color, created_by, workshop_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(plate, brand, model, color, createdBy, requestWorkshopId(req));
        const data = db.prepare(`SELECT * FROM mobil_masuk WHERE id = ? AND workshop_id = ?`).get(result.lastInsertRowid, requestWorkshopId(req));
        res.status(201).json({ success: true, message: "Data Mobil Masuk berhasil disimpan.", data });
    } catch (error) {
        console.error("POST MOBIL MASUK ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal menyimpan data Mobil Masuk." });
    }
});

app.delete("/api/mobil-masuk/:id", (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!idValid(id)) return res.status(400).json({ success: false, message: "Data Mobil Masuk tidak valid." });
        const row = db.prepare(`SELECT id, used_estimate_id, used_at FROM mobil_masuk WHERE id = ? AND workshop_id = ?`).get(id, requestWorkshopId(req));
        if (!row) return res.status(404).json({ success: false, message: "Data Mobil Masuk tidak ditemukan." });
        if (row.used_at || row.used_estimate_id) {
            return res.status(409).json({ success: false, message: "Mobil Masuk yang sudah digunakan untuk Estimasi tidak dapat dihapus." });
        }
        const result = db.prepare(`DELETE FROM mobil_masuk WHERE id = ? AND workshop_id = ? AND used_at IS NULL AND used_estimate_id IS NULL`).run(id, requestWorkshopId(req));
        if (!result.changes) return res.status(409).json({ success: false, message: "Data Mobil Masuk tidak dapat dihapus." });
        res.json({ success: true, message: "Data Mobil Masuk berhasil dihapus." });
    } catch (error) {
        console.error("DELETE MOBIL MASUK ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal menghapus data Mobil Masuk." });
    }
});

app.get("/api/laporan/penghapusan", (req, res) => {
    try {
        const range = validReportRange(req, res);
        if (!range) return;
        const data = db.prepare(`
            SELECT
                dh.id,
                dh.document_type,
                dh.document_number,
                dh.deleted_at,
                dh.customer_name,
                dh.insurer_alias,
                dh.reason,
                COALESCE(u.full_name, u.username, '-') AS deleted_by_name
            FROM deletion_history dh
            LEFT JOIN users u ON u.id = dh.deleted_by
            WHERE dh.workshop_id = ?
              AND date(datetime(dh.deleted_at, '+7 hours')) BETWEEN date(?) AND date(?)
            ORDER BY dh.deleted_at DESC, dh.id DESC
        `).all(requestWorkshopId(req), range.from, range.to);
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET LAPORAN PENGHAPUSAN ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil Laporan Penghapusan." });
    }
});

app.get("/api/laporan/mobil-masuk", (req, res) => {
    try {
        const range = validReportRange(req, res);
        if (!range) return;
        const data = db.prepare(`
            SELECT
                w.id, w.wo_number, w.created_at AS wo_created_at, w.check_in_at,
                e.estimate_number, i.name AS insurer_name,
                i.alias AS insurer_alias,
                c.name AS customer_name,
                v.plate_number, v.brand, v.model, v.color,
                u.full_name AS user_name, u.username
            FROM wo w
            INNER JOIN estimates e ON e.id = w.estimate_id
            INNER JOIN customers c ON c.id = e.customer_id
            INNER JOIN vehicles v ON v.id = e.vehicle_id
            LEFT JOIN insurers i ON i.id = e.insurer_id
            LEFT JOIN users u ON u.id = w.created_by
            WHERE w.workshop_id = ?
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND v.workshop_id = w.workshop_id
              AND date(datetime(COALESCE(w.check_in_at, w.created_at), '+7 hours')) BETWEEN date(?) AND date(?)
              AND (? IS NULL OR w.created_by = ?)
            ORDER BY COALESCE(w.check_in_at, w.created_at) ASC, w.id ASC
        `).all(requestWorkshopId(req), range.from, range.to, range.userId, range.userId);
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET LAPORAN MOBIL MASUK ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil Laporan Mobil Masuk." });
    }
});

app.get("/api/laporan/mobil-keluar", (req, res) => {
    try {
        const range = validReportRange(req, res);
        if (!range) return;
        const data = db.prepare(`
            SELECT
                w.id, w.wo_number, w.check_in_at, w.check_out_at, w.target_date,
                e.estimate_number, i.name AS insurer_name,
                i.alias AS insurer_alias,
                c.name AS customer_name,
                v.plate_number, v.brand, v.model, v.color,
                u.full_name AS user_name, u.username,
                COALESCE(
                    (SELECT h.note FROM wo_process_history h
                     WHERE h.wo_id = w.id AND UPPER(h.status) = 'CHECK OUT'
                     ORDER BY h.id DESC LIMIT 1),
                    w.notes
                ) AS checkout_note
            FROM wo w
            INNER JOIN estimates e ON e.id = w.estimate_id
            INNER JOIN customers c ON c.id = e.customer_id
            INNER JOIN vehicles v ON v.id = e.vehicle_id
            LEFT JOIN insurers i ON i.id = e.insurer_id
            LEFT JOIN users u ON u.id = w.created_by
            WHERE w.workshop_id = ?
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND v.workshop_id = w.workshop_id
              AND UPPER(w.status) = 'CHECK OUT'
              AND w.check_out_at IS NOT NULL
              AND date(datetime(w.check_out_at, '+7 hours')) BETWEEN date(?) AND date(?)
              AND (? IS NULL OR w.created_by = ?)
            ORDER BY w.check_out_at ASC, w.id ASC
        `).all(requestWorkshopId(req), range.from, range.to, range.userId, range.userId);
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET LAPORAN MOBIL KELUAR ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil Laporan Mobil Keluar." });
    }
});

app.get("/api/laporan/own-risk", (req, res) => {
    try {
        const range = validReportRange(req, res);
        if (!range) return;
        const data = db.prepare(`
            SELECT
                p.id AS payment_id, p.wo_id, p.payment_method, p.amount, p.description AS payment_description,
                p.paid_at,
                w.wo_number,
                e.estimate_number, i.name AS insurer_name, e.own_risk,
                i.alias AS insurer_alias,
                c.name AS customer_name,
                v.plate_number,
                i.name AS insurer_name,
                i.alias AS insurer_alias,
                u.full_name AS user_name, u.username
            FROM own_risk_payments p
            INNER JOIN wo w ON w.id = p.wo_id
            INNER JOIN estimates e ON e.id = w.estimate_id
            INNER JOIN customers c ON c.id = e.customer_id
            INNER JOIN vehicles v ON v.id = e.vehicle_id
            LEFT JOIN insurers i ON i.id = e.insurer_id
            LEFT JOIN users u ON u.id = p.created_by
            WHERE p.workshop_id = ?
              AND w.workshop_id = p.workshop_id
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND v.workshop_id = w.workshop_id
              AND date(datetime(p.paid_at, '+7 hours')) BETWEEN date(?) AND date(?)
            ORDER BY p.paid_at ASC, p.id ASC
        `).all(requestWorkshopId(req), range.from, range.to);
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET LAPORAN OWN RISK ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil Laporan Tagihan Own Risk." });
    }
});

app.get("/api/laporan/own-risk-outstanding", (req, res) => {
    try {
        // BELUM LUNAS OR = belum ada pembayaran OR sama sekali.
        // Jika sudah ada pembayaran berapa pun nominalnya, status OR adalah LUNAS.
        // Tidak menggunakan periode tanggal.
        const data = db.prepare(`
            SELECT
                w.id AS wo_id,
                w.wo_number,
                e.estimate_number,
                i.name AS insurer_name,
                i.alias AS insurer_alias,
                c.name AS customer_name,
                v.plate_number,
                COALESCE(e.own_risk, 0) AS own_risk,
                COALESCE((
                    SELECT SUM(p.amount)
                    FROM own_risk_payments p
                    WHERE p.wo_id = w.id AND p.workshop_id = w.workshop_id
                ), 0) AS amount_paid,
                COALESCE(e.own_risk, 0) - COALESCE((
                    SELECT SUM(p.amount)
                    FROM own_risk_payments p
                    WHERE p.wo_id = w.id AND p.workshop_id = w.workshop_id
                ), 0) AS amount_remaining,
                u.full_name AS user_name,
                u.username
            FROM wo w
            INNER JOIN estimates e ON e.id = w.estimate_id
            INNER JOIN customers c ON c.id = e.customer_id
            INNER JOIN vehicles v ON v.id = e.vehicle_id
            LEFT JOIN insurers i ON i.id = e.insurer_id
            LEFT JOIN users u ON u.id = w.created_by
            WHERE w.workshop_id = ?
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND v.workshop_id = w.workshop_id
              AND COALESCE(e.own_risk, 0) > 0
              AND NOT EXISTS (
                  SELECT 1
                  FROM own_risk_payments p
                  WHERE p.wo_id = w.id AND p.workshop_id = w.workshop_id
              )
            ORDER BY w.id ASC
        `).all(requestWorkshopId(req));
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET LAPORAN OUTSTANDING OWN RISK ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil Laporan Tagihan Own Risk Belum Lunas." });
    }
});

app.get("/api/laporan/kuitansi", (req, res) => {
    try {
        const range = validReportRange(req, res);
        if (!range) return;
        const data = db.prepare(`
            SELECT
                tk.id AS kuitansi_id, tk.created_at AS kuitansi_created_at,
                tk.grand_total, tk.claim_number,
                w.id AS wo_id, w.wo_number,
                e.estimate_number, i.name AS insurer_name,
                i.alias AS insurer_alias,
                c.name AS customer_name,
                v.plate_number,
                i.name AS insurer_name,
                i.alias AS insurer_alias,
                u.full_name AS user_name, u.username
            FROM tagihan_kuitansi tk
            INNER JOIN wo w ON w.id = tk.wo_id
            INNER JOIN estimates e ON e.id = w.estimate_id
            INNER JOIN customers c ON c.id = e.customer_id
            INNER JOIN vehicles v ON v.id = e.vehicle_id
            LEFT JOIN insurers i ON i.id = e.insurer_id
            LEFT JOIN users u ON u.id = tk.created_by
            WHERE tk.workshop_id = ?
              AND w.workshop_id = tk.workshop_id
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND v.workshop_id = w.workshop_id
              AND date(datetime(tk.created_at, '+7 hours')) BETWEEN date(?) AND date(?)
            ORDER BY tk.created_at ASC, tk.id ASC
        `).all(requestWorkshopId(req), range.from, range.to);
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET LAPORAN KUITANSI ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil Laporan Kuitansi Tagihan." });
    }
});

app.get("/api/laporan/vendor-produksi", (req, res) => {
    try {
        const range = validReportRange(req, res);
        if (!range) return;
        const workerName = String(req.query.worker_name || "").trim();
        const data = db.prepare(`
            SELECT
                p.id AS worker_price_id,
                p.wo_id,
                p.worker_name,
                p.worker_type,
                p.worker_price,
                p.created_at AS input_at,
                p.updated_at,
                w.wo_number,
                e.estimate_number, i.name AS insurer_name,
                i.alias AS insurer_alias,
                c.name AS customer_name,
                v.plate_number,
                v.brand,
                v.model
            FROM production_worker_prices p
            INNER JOIN wo w ON w.id = p.wo_id
            INNER JOIN estimates e ON e.id = w.estimate_id
            INNER JOIN customers c ON c.id = e.customer_id
            INNER JOIN vehicles v ON v.id = e.vehicle_id
            LEFT JOIN insurers i ON i.id = e.insurer_id
            WHERE p.workshop_id = ?
              AND w.workshop_id = p.workshop_id
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND v.workshop_id = w.workshop_id
              AND date(datetime(p.created_at, '+7 hours')) BETWEEN date(?) AND date(?)
              AND (? = '' OR LOWER(TRIM(p.worker_name)) LIKE LOWER('%' || ? || '%'))
            ORDER BY p.created_at ASC, p.id ASC
        `).all(requestWorkshopId(req), range.from, range.to, workerName, workerName);
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET LAPORAN VENDOR PRODUKSI ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil Laporan Vendor Produksi." });
    }
});

// ============================================================
// LAPORAN KOMISI AGENT
// Nilai komisi diambil dari Pemakaian Bahan dengan kode KOMISI_AGENT.
// Nama Agent berasal dari Estimasi/WO. Laporan mengikuti tanggal dibuatnya
// Tagihan Kuitansi karena nilai komisi terkait tagihan yang sudah dibuat.
// ============================================================
app.get("/api/laporan/komisi-agent", (req, res) => {
    try {
        const range = validReportRange(req, res);
        if (!range) return;
        const agentName = String(req.query.agent_name || "").trim();

        const data = db.prepare(`
            SELECT
                w.id AS wo_id,
                w.wo_number,
                c.name AS customer_name,
                i.name AS insurer_name,
                i.alias AS insurer_alias,
                tk.grand_total AS nilai_kuitansi,
                e.agent AS agent_name,
                COALESCE((
                    SELECT SUM(mu.total)
                    FROM material_usage mu
                    WHERE mu.wo_id = w.id
                      AND UPPER(TRIM(mu.material_code)) = 'KOMISI_AGENT'
                ), 0) AS nilai_komisi,
                tk.created_at AS kuitansi_created_at
            FROM tagihan_kuitansi tk
            INNER JOIN wo w ON w.id = tk.wo_id
            INNER JOIN estimates e ON e.id = w.estimate_id
            INNER JOIN customers c ON c.id = e.customer_id
            LEFT JOIN insurers i ON i.id = e.insurer_id
            WHERE tk.workshop_id = ?
              AND w.workshop_id = tk.workshop_id
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND date(datetime(tk.created_at, '+7 hours')) BETWEEN date(?) AND date(?)
              AND (? = '' OR LOWER(TRIM(COALESCE(e.agent, ''))) LIKE LOWER('%' || ? || '%'))
            ORDER BY tk.created_at ASC, w.id ASC
        `).all(requestWorkshopId(req), range.from, range.to, agentName, agentName);

        res.json({ success:true, data });
    } catch (error) {
        console.error("GET LAPORAN KOMISI AGENT ERROR:", error);
        res.status(500).json({ success:false, message:error.message || "Gagal mengambil Laporan Komisi Agent." });
    }
});

// ============================================================
// LAPORAN OMSET
// Income = Nilai Kuitansi Tagihan - seluruh biaya operasional terkait WO.
// PPN dan PPh hanya informasi dan tidak menjadi komponen pengurang/penambah.
// ============================================================
app.get("/api/laporan/omset", (req, res) => {
    try {
        const range = validReportRange(req, res);
        if (!range) return;

        const data = db.prepare(`
            SELECT
                tk.id AS kuitansi_id, tk.kuitansi_number,
                tk.wo_id,
                tk.created_at AS kuitansi_created_at,
                COALESCE(tk.grand_total, 0) AS nilai_kuitansi,
                COALESCE(tk.ppn_amount, 0) AS ppn_amount,
                COALESCE(tk.pph_amount, 0) AS pph_amount,
                w.wo_number,
                i.name AS insurer_name,
                i.alias AS insurer_alias,
                c.name AS customer_name,
                v.plate_number,
                COALESCE((SELECT SUM(CASE WHEN UPPER(TRIM(p.worker_type)) = 'KETOK' THEN p.worker_price ELSE 0 END) FROM production_worker_prices p WHERE p.wo_id = w.id AND p.workshop_id = w.workshop_id), 0) AS ketok,
                COALESCE((SELECT SUM(CASE WHEN UPPER(TRIM(p.worker_type)) = 'DEMPUL' THEN p.worker_price ELSE 0 END) FROM production_worker_prices p WHERE p.wo_id = w.id AND p.workshop_id = w.workshop_id), 0) AS dempul,
                COALESCE((SELECT SUM(CASE WHEN UPPER(TRIM(p.worker_type)) = 'CAT' THEN p.worker_price ELSE 0 END) FROM production_worker_prices p WHERE p.wo_id = w.id AND p.workshop_id = w.workshop_id), 0) AS cat,
                COALESCE((SELECT SUM(CASE WHEN UPPER(TRIM(p.worker_type)) = 'POLES' THEN p.worker_price ELSE 0 END) FROM production_worker_prices p WHERE p.wo_id = w.id AND p.workshop_id = w.workshop_id), 0) AS poles,
                COALESCE((SELECT SUM(CASE WHEN UPPER(TRIM(mu.material_code)) NOT IN ('BIAYA_SURVEY','KOMISI_AGENT') THEN mu.total ELSE 0 END) FROM material_usage mu WHERE mu.wo_id = w.id AND mu.workshop_id = w.workshop_id), 0) AS pemakaian_bahan,
                COALESCE((SELECT SUM(CASE WHEN UPPER(TRIM(mu.material_code)) = 'BIAYA_SURVEY' THEN mu.total ELSE 0 END) FROM material_usage mu WHERE mu.wo_id = w.id AND mu.workshop_id = w.workshop_id), 0) AS biaya_survey,
                COALESCE((SELECT SUM(CASE WHEN UPPER(TRIM(mu.material_code)) = 'KOMISI_AGENT' THEN mu.total ELSE 0 END) FROM material_usage mu WHERE mu.wo_id = w.id AND mu.workshop_id = w.workshop_id), 0) AS biaya_agent
            FROM tagihan_kuitansi tk
            INNER JOIN wo w ON w.id = tk.wo_id
            INNER JOIN estimates e ON e.id = w.estimate_id
            INNER JOIN customers c ON c.id = e.customer_id
            INNER JOIN vehicles v ON v.id = e.vehicle_id
            LEFT JOIN insurers i ON i.id = e.insurer_id
            WHERE tk.workshop_id = ?
              AND w.workshop_id = tk.workshop_id
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND v.workshop_id = w.workshop_id
              AND date(datetime(tk.created_at, '+7 hours')) BETWEEN date(?) AND date(?)
            ORDER BY tk.created_at ASC, tk.id ASC
        `).all(requestWorkshopId(req), range.from, range.to);

        // Harga beli sparepart BENGKEL berasal dari Purchase Order yang tersimpan
        // di penyimpanan pusat aplikasi (app_storage: purchase_orders).
        let purchaseOrders = [];
        try {
            const stored = storageRead(req, 'purchase_orders');
            const parsed = stored?.data_json ? JSON.parse(stored.data_json) : [];
            purchaseOrders = Array.isArray(parsed) ? parsed : [];
        } catch (storageError) {
            console.warn('LAPORAN OMSET: gagal membaca purchase_orders:', storageError.message);
        }

        const poCostByWO = new Map();
        purchaseOrders.forEach(po => {
            const key = String(po?.wo_id ?? po?.woId ?? '').trim();
            if (!key) return;
            const items = Array.isArray(po?.items) ? po.items : [];
            const total = items.reduce((sum, item) => {
                const qty = Number(item?.quantity ?? item?.qty ?? 1) || 0;
                const price = Number(item?.net_buy_price ?? item?.buy_price ?? 0) || 0;
                return sum + (qty * price);
            }, 0);
            poCostByWO.set(key, total);
        });

        const result = data.map(row => {
            const netto_harga_beli_sparepart = Number(poCostByWO.get(String(row.wo_id)) || 0);
            const ketok = Number(row.ketok || 0);
            const dempul = Number(row.dempul || 0);
            const cat = Number(row.cat || 0);
            const poles = Number(row.poles || 0);
            const total_vendor_produksi = ketok + dempul + cat + poles;
            const pemakaian_bahan = Number(row.pemakaian_bahan || 0);
            const biaya_survey = Number(row.biaya_survey || 0);
            const biaya_agent = Number(row.biaya_agent || 0);
            const nilai_kuitansi = Number(row.nilai_kuitansi || 0);
            const total_biaya = netto_harga_beli_sparepart + total_vendor_produksi + pemakaian_bahan + biaya_survey + biaya_agent;
            return {
                ...row,
                netto_harga_beli_sparepart,
                total_vendor_produksi,
                total_biaya,
                income: nilai_kuitansi - total_biaya
            };
        });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error("GET LAPORAN OMSET ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil Laporan Omset." });
    }
});

app.get("/api/laporan/outstanding-wo", (req, res) => {
    try {
        const range = validReportRange(req, res);
        if (!range) return;

        // Outstanding WO = WO yang PERNAH melakukan CHECK OUT pertama kali
        // tetapi belum pernah mempunyai Tagihan Kuitansi.
        // CHECK IN AGAIN tidak menghapus riwayat CHECK OUT pertama.
        const data = db.prepare(`
            WITH first_checkout AS (
                SELECT
                    h.wo_id,
                    h.changed_at AS first_checkout_at,
                    h.note AS checkout_note
                FROM wo_process_history h
                INNER JOIN (
                    SELECT wo_id, MIN(id) AS first_id
                    FROM wo_process_history
                    WHERE workshop_id = ? AND UPPER(status) = 'CHECK OUT'
                    GROUP BY wo_id
                ) first_h
                    ON first_h.first_id = h.id
                WHERE h.workshop_id = ? AND UPPER(h.status) = 'CHECK OUT'

                UNION ALL

                /* Compatibility for old WO yang belum memiliki history CHECK OUT. */
                SELECT
                    w.id AS wo_id,
                    w.check_out_at AS first_checkout_at,
                    w.notes AS checkout_note
                FROM wo w
                WHERE w.workshop_id = ?
                  AND w.check_out_at IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM wo_process_history h
                      WHERE h.wo_id = w.id
                        AND h.workshop_id = w.workshop_id
                        AND UPPER(h.status) = 'CHECK OUT'
                  )
            )
            SELECT
                w.id,
                w.wo_number,
                fc.first_checkout_at,
                e.estimate_number,
                i.name AS insurer_name,
                i.alias AS insurer_alias,
                c.name AS customer_name,
                v.plate_number,
                v.brand,
                v.model,
                v.color,
                u.full_name AS user_name,
                u.username,
                CASE
                    WHEN TRIM(COALESCE(fc.checkout_note, '')) <> ''
                         AND TRIM(COALESCE(w.completed_note, '')) <> ''
                        THEN TRIM(fc.checkout_note) || ' | Keterangan WO Selesai: ' || TRIM(w.completed_note)
                    WHEN TRIM(COALESCE(w.completed_note, '')) <> ''
                        THEN 'Keterangan WO Selesai: ' || TRIM(w.completed_note)
                    ELSE fc.checkout_note
                END AS checkout_note
            FROM wo w
            INNER JOIN first_checkout fc
                ON fc.wo_id = w.id
            INNER JOIN estimates e
                ON e.id = w.estimate_id
            INNER JOIN customers c
                ON c.id = e.customer_id
            INNER JOIN vehicles v
                ON v.id = e.vehicle_id
            LEFT JOIN insurers i
                ON i.id = e.insurer_id
            LEFT JOIN users u
                ON u.id = w.created_by
            WHERE w.workshop_id = ?
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND v.workshop_id = w.workshop_id
              AND NOT EXISTS (
                SELECT 1
                FROM tagihan_kuitansi tk
                WHERE tk.wo_id = w.id AND tk.workshop_id = w.workshop_id
            )
              AND date(datetime(fc.first_checkout_at, '+7 hours'))
                    BETWEEN date(?) AND date(?)
              AND (? IS NULL OR w.created_by = ?)
            ORDER BY fc.first_checkout_at ASC, w.id ASC
        `).all(
            requestWorkshopId(req), requestWorkshopId(req), requestWorkshopId(req),
            requestWorkshopId(req), range.from, range.to, range.userId, range.userId
        );

        res.json({ success: true, data });
    } catch (error) {
        console.error("GET LAPORAN OUTSTANDING WO ERROR:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Gagal mengambil Laporan Outstanding WO."
        });
    }
});


app.get("/api/laporan/outstanding-pembayaran", (req, res) => {
    try {
        const range = validReportRange(req, res);
        if (!range) return;

        // Outstanding Pembayaran = Tagihan Kuitansi yang sudah dibuat,
        // tetapi belum memiliki pembayaran sama sekali.
        const data = db.prepare(`
            SELECT
                tk.id AS kuitansi_id, tk.kuitansi_number,
                tk.wo_id,
                tk.grand_total,
                tk.created_at AS kuitansi_created_at,
                w.wo_number,
                e.estimate_number,
                e.claim_number,
                i.name AS insurer_name,
                i.alias AS insurer_alias,
                c.name AS customer_name,
                v.plate_number,
                v.brand,
                v.model,
                v.color,
                COALESCE(u.full_name, u.username) AS user_name,
                u.username
            FROM tagihan_kuitansi tk
            INNER JOIN wo w
                ON w.id = tk.wo_id
            INNER JOIN estimates e
                ON e.id = w.estimate_id
            INNER JOIN customers c
                ON c.id = e.customer_id
            INNER JOIN vehicles v
                ON v.id = e.vehicle_id
            LEFT JOIN insurers i
                ON i.id = e.insurer_id
            LEFT JOIN users u
                ON u.id = w.created_by
            WHERE tk.workshop_id = ?
              AND w.workshop_id = tk.workshop_id
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND v.workshop_id = w.workshop_id
              AND NOT EXISTS (
                SELECT 1
                FROM pembayaran_kuitansi pk
                WHERE pk.wo_id = tk.wo_id AND pk.workshop_id = tk.workshop_id
            )
              AND date(datetime(tk.created_at, '+7 hours'))
                    BETWEEN date(?) AND date(?)
            ORDER BY tk.created_at ASC, tk.id ASC
        `).all(requestWorkshopId(req), range.from, range.to);

        res.json({ success: true, data });
    } catch (error) {
        console.error("GET LAPORAN OUTSTANDING PEMBAYARAN ERROR:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Gagal mengambil Laporan Outstanding Pembayaran."
        });
    }
});


// ============================================================
// TAGIHAN OWN RISK (OR)
// Sumber nilai OR: estimates.own_risk
// Sumber WO: status SELESAI atau CHECK OUT
// ============================================================

app.get(
    "/api/tagihan-or",
    (req, res) => {
        try {
            const data = db.prepare(`
                SELECT
                    w.id AS wo_id,
                    w.wo_number,
                    w.estimate_id,
                    w.status AS wo_status,
                    w.created_at AS wo_created_at,
                    w.check_out_at,
                    e.estimate_number,
                    e.estimate_date,
                    e.own_risk,
                    c.customer_code,
                    c.name AS customer_name,
                    c.phone AS customer_phone,
                    i.name AS insurer_name,
                    i.alias AS insurer_alias,
                    v.plate_number,
                    v.brand,
                    v.model,
                    v.year,
                    COALESCE(SUM(p.amount), 0) AS paid_amount,
                    COALESCE((SELECT b.free_amount FROM own_risk_billing b WHERE b.wo_id = w.id AND b.workshop_id = w.workshop_id LIMIT 1), 0) AS free_amount,
                    (SELECT p2.description FROM own_risk_payments p2 WHERE p2.wo_id = w.id AND p2.workshop_id = w.workshop_id ORDER BY p2.id DESC LIMIT 1) AS payment_description
                FROM wo w
                INNER JOIN estimates e ON e.id = w.estimate_id
                INNER JOIN customers c ON c.id = e.customer_id
                INNER JOIN vehicles v ON v.id = e.vehicle_id
                LEFT JOIN insurers i ON i.id = e.insurer_id
                LEFT JOIN own_risk_payments p ON p.wo_id = w.id AND p.workshop_id = w.workshop_id
                WHERE w.workshop_id = ?
                  AND e.workshop_id = w.workshop_id
                  AND c.workshop_id = w.workshop_id
                  AND v.workshop_id = w.workshop_id
                  AND UPPER(w.status) IN ('SELESAI', 'CHECK OUT')
                  AND COALESCE(e.own_risk, 0) > 0
                GROUP BY w.id
                ORDER BY w.id DESC
            `).all(requestWorkshopId(req));

            const normalized = data.map(row => {
                const ownRisk = Math.max(0, angka(row.own_risk));
                const paid = Math.max(0, angka(row.paid_amount));
                const freeAmount = Math.min(ownRisk, Math.max(0, angka(row.free_amount)));
                const amountDue = Math.max(0, ownRisk - freeAmount);
                const remaining = Math.max(0, amountDue - paid);
                return {
                    ...row,
                    own_risk: ownRisk,
                    free_amount: freeAmount,
                    amount_due: amountDue,
                    paid_amount: paid,
                    remaining_amount: remaining,
                    payment_status: remaining <= 0 ? "LUNAS" : "BELUM LUNAS"
                };
            });

            res.json({ success: true, data: normalized });
        } catch (error) {
            console.error("GET TAGIHAN OR ERROR:", error);
            res.status(500).json({
                success: false,
                message: error.message || "Gagal mengambil Tagihan Own Risk (OR)."
            });
        }
    }
);


// ============================================================
// DETAIL TAGIHAN OWN RISK
// ============================================================

app.get(
    "/api/tagihan-or/:woId",
    (req, res) => {
        try {
            const woId = Number(req.params.woId);
            if (!idValid(woId)) {
                return res.status(400).json({ success: false, message: "ID WO tidak valid." });
            }

            const row = db.prepare(`
                SELECT
                    w.id AS wo_id,
                    w.wo_number,
                    w.status AS wo_status,
                    w.check_out_at,
                    e.id AS estimate_id,
                    e.estimate_number,
                    e.estimate_date,
                    e.own_risk,
                    c.customer_code,
                    c.name AS customer_name,
                    c.phone AS customer_phone,
                    i.name AS insurer_name,
                    i.alias AS insurer_alias,
                    v.plate_number,
                    v.brand,
                    v.model,
                    v.year,
                    v.color,
                    v.vin_number,
                    v.engine_number,
                    COALESCE(SUM(p.amount), 0) AS paid_amount,
                    (SELECT p2.description FROM own_risk_payments p2 WHERE p2.wo_id = w.id AND p2.workshop_id = w.workshop_id ORDER BY p2.id DESC LIMIT 1) AS payment_description
                FROM wo w
                INNER JOIN estimates e ON e.id = w.estimate_id
                INNER JOIN customers c ON c.id = e.customer_id
                INNER JOIN vehicles v ON v.id = e.vehicle_id
                LEFT JOIN insurers i ON i.id = e.insurer_id
                LEFT JOIN own_risk_payments p ON p.wo_id = w.id AND p.workshop_id = w.workshop_id
                WHERE w.id = ? AND w.workshop_id = ?
                GROUP BY w.id
                LIMIT 1
            `).get(woId, requestWorkshopId(req));

            if (!row) {
                return res.status(404).json({ success: false, message: "WO tidak ditemukan." });
            }

            if (!["SELESAI", "CHECK OUT"].includes(String(row.wo_status || "").toUpperCase())) {
                return res.status(400).json({
                    success: false,
                    message: "Tagihan Own Risk hanya dapat dibuat untuk WO dengan status SELESAI atau CHECK OUT."
                });
            }

            const ownRisk = Math.max(0, angka(row.own_risk));
            if (ownRisk <= 0) {
                return res.status(404).json({
                    success: false,
                    message: "WO ini tidak memiliki Tagihan Own Risk (OR) karena nilai OR pada Estimasi adalah 0."
                });
            }
            const paid = Math.max(0, angka(row.paid_amount));
            const freeAmount = Math.min(ownRisk, Math.max(0, angka(row.free_amount)));
            row.own_risk = ownRisk;
            row.free_amount = freeAmount;
            row.amount_due = Math.max(0, ownRisk - freeAmount);
            row.paid_amount = paid;
            row.remaining_amount = Math.max(0, row.amount_due - paid);
            row.payment_status = row.remaining_amount <= 0 ? "LUNAS" : "BELUM LUNAS";

            const payments = db.prepare(`
                SELECT id, payment_method, amount, description, paid_at
                FROM own_risk_payments
                WHERE wo_id = ? AND workshop_id = ?
                ORDER BY id DESC
            `).all(woId, requestWorkshopId(req));

            res.json({ success: true, data: row, payments });
        } catch (error) {
            console.error("GET DETAIL TAGIHAN OR ERROR:", error);
            res.status(500).json({
                success: false,
                message: error.message || "Gagal mengambil detail Tagihan Own Risk."
            });
        }
    }
);


// ============================================================
// PEMBAYARAN OWN RISK
// ============================================================

app.post(
    "/api/tagihan-or/:woId/pembayaran",
    (req, res) => {
        try {
            const woId = Number(req.params.woId);
            if (!idValid(woId)) {
                return res.status(400).json({ success: false, message: "ID WO tidak valid." });
            }

            const paymentMethod = String(req.body.payment_method || "").trim().toUpperCase();
            const allowedMethods = ["TUNAI", "DEBIT", "CREDIT", "QRIS", "TRANSFER"];
            if (!allowedMethods.includes(paymentMethod)) {
                return res.status(400).json({
                    success: false,
                    message: "Metode pembayaran harus TUNAI, DEBIT, CREDIT, QRIS, atau TRANSFER."
                });
            }

            const amount = angka(req.body.amount);
            const freeAmount = angka(req.body.free_amount ?? req.body.freeAmount);
            if (amount < 0) {
                return res.status(400).json({ success: false, message: "Nilai Dibayar tidak boleh kurang dari 0." });
            }
            if (freeAmount < 0) {
                return res.status(400).json({ success: false, message: "Nilai Free tidak boleh kurang dari 0." });
            }

            const wo = db.prepare(`
                SELECT w.id, w.wo_number, w.status, e.own_risk
                FROM wo w
                INNER JOIN estimates e ON e.id = w.estimate_id AND e.workshop_id = w.workshop_id
                WHERE w.id = ? AND w.workshop_id = ?
                LIMIT 1
            `).get(woId, requestWorkshopId(req));

            if (!wo) {
                return res.status(404).json({ success: false, message: "WO tidak ditemukan." });
            }
            if (!["SELESAI", "CHECK OUT"].includes(String(wo.status || "").toUpperCase())) {
                return res.status(400).json({ success: false, message: "Pembayaran Own Risk hanya untuk WO status SELESAI atau CHECK OUT." });
            }

            const ownRisk = Math.max(0, angka(wo.own_risk));
            if (ownRisk <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Pembayaran Own Risk tidak dapat dilakukan karena nilai OR pada Estimasi adalah 0."
                });
            }
            const paid = Math.max(0, angka(db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM own_risk_payments WHERE wo_id = ? AND workshop_id = ?`).get(woId, requestWorkshopId(req)).total));
            const savedFree = Math.max(0, angka(db.prepare(`SELECT COALESCE(free_amount,0) AS free_amount FROM own_risk_billing WHERE wo_id = ? AND workshop_id = ? LIMIT 1`).get(woId, requestWorkshopId(req))?.free_amount));
            const hasFreeInput = req.body.free_amount !== undefined || req.body.freeAmount !== undefined;
            const requestedFree = hasFreeInput ? freeAmount : savedFree;
            const effectiveFree = Math.min(ownRisk, Math.max(0, requestedFree));
            const amountDue = Math.max(0, ownRisk - effectiveFree);
            const remaining = Math.max(0, amountDue - paid);
            if (amount + paid > amountDue) {
                return res.status(400).json({ success: false, message: `Nilai Dibayar melebihi Nilai Harus Dibayar. Maksimal Rp ${remaining.toLocaleString("id-ID")}.` });
            }

            db.prepare(`
                INSERT INTO own_risk_billing (wo_id, free_amount, updated_at, workshop_id)
                VALUES (?, ?, CURRENT_TIMESTAMP, ?)
                ON CONFLICT(wo_id) DO UPDATE SET free_amount=excluded.free_amount, updated_at=CURRENT_TIMESTAMP, workshop_id=excluded.workshop_id
            `).run(woId, effectiveFree, requestWorkshopId(req));

            const description = teks(req.body.description);
            const createdBy = auditUserId(req);

            const result = db.prepare(`
                INSERT INTO own_risk_payments
                (wo_id, payment_method, amount, description, created_by, workshop_id)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(woId, paymentMethod, amount, description || null, createdBy, requestWorkshopId(req));

            const newPaid = paid + amount;
            const newRemaining = Math.max(0, amountDue - newPaid);

            res.status(201).json({
                success: true,
                message: "Pembayaran berhasil. Tagihan Own Risk Lunas.",
                data: {
                    id: result.lastInsertRowid,
                    wo_id: woId,
                    wo_number: wo.wo_number,
                    own_risk: ownRisk,
                    free_amount: effectiveFree,
                    amount_due: amountDue,
                    paid_amount: newPaid,
                    remaining_amount: newRemaining,
                    payment_status: newRemaining <= 0 ? "LUNAS" : "BELUM LUNAS"
                }
            });
        } catch (error) {
            console.error("POST PEMBAYARAN OR ERROR:", error);
            res.status(500).json({
                success: false,
                message: error.message || "Gagal menyimpan pembayaran Own Risk."
            });
        }
    }
);



// ============================================================
// TAGIHAN KUITANSI PERBAIKAN
// ============================================================

// Aturan Tagihan Kuitansi:
// - Sparepart BENGKEL wajib sudah memiliki Purchase Order.
// - Sparepart SUPPLY tidak memerlukan Purchase Order.
// Pemeriksaan dilakukan dari estimate_spareparts + Purchase Order
// yang tersimpan di app_storage, sehingga tidak bergantung pada localStorage browser.
function cekPOBengkelUntukKuitansi(woId, estimateId, workshopId) {
    const parts = db.prepare(`
        SELECT id, part_name, quantity, supply_bengkel
        FROM estimate_spareparts
        WHERE estimate_id = ? AND workshop_id = ?
        ORDER BY sequence ASC, id ASC
    `).all(estimateId, Number(workshopId || 0));

    const bengkelParts = parts.filter(item =>
        String(item?.supply_bengkel ?? "BENGKEL").trim().toUpperCase() !== "SUPPLY"
    );

    // SUPPLY tidak menjadi syarat PO untuk Tagihan Kuitansi.
    if (!bengkelParts.length) {
        return { required: false, ready: true, total: 0, missing: [] };
    }

    const storage = db.prepare(
        `SELECT data_json FROM app_storage WHERE storage_key = ? AND workshop_id = ? LIMIT 1`
    ).get("purchase_orders", Number(workshopId || 0));

    let purchaseOrders = [];
    try {
        const parsed = storage?.data_json ? JSON.parse(storage.data_json) : [];
        purchaseOrders = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        purchaseOrders = [];
    }

    const po = purchaseOrders.find(x =>
        String(x?.wo_id ?? x?.woId ?? "") === String(woId)
    );

    // Yang diwajibkan adalah PO SUDAH DIBUAT.
    // Kedatangan sparepart tidak menjadi syarat pembuatan Tagihan Kuitansi.
    const ready = !!po;

    return {
        required: true,
        ready,
        total: bengkelParts.length,
        missing: ready ? [] : bengkelParts.map(x => x.part_name || "-")
    };
}

function isAsuransiUmumPribadi(name) {
    const normalized = teks(name).replace(/\s+/g, " ").trim().toUpperCase();
    return normalized.includes("UMUM") || normalized.includes("PRIBADI");
}

function hitungTagihanKuitansi(body, estimate) {
    const umumPribadi = isAsuransiUmumPribadi(estimate?.insurer_name);
    // Untuk Asuransi UMUM / PRIBADI, nilai Tagihan Kuitansi wajib bersumber langsung dari Estimasi.
    const totalJasaPerbaikan = Math.max(0, angka(umumPribadi ? estimate.total_jasa : body.total_jasa_perbaikan));
    const materialPercent = Math.max(0, Math.min(100, angka(estimate.material_percent)));
    const labourPercent = 100 - materialPercent;
    const materialAmount = totalJasaPerbaikan * materialPercent / 100;
    const labourAmount = totalJasaPerbaikan * labourPercent / 100;
    // UMUM / PRIBADI: nilai sparepart wajib sama dengan TOTAL SPAREPART pada Estimasi.
    // Asuransi lainnya tetap menggunakan nilai sparepart BENGKEL yang menjadi dasar PO.
    // Sparepart SUPPLY tidak dicampurkan ke nilai BENGKEL untuk asuransi lainnya.
    const sparepartSource = umumPribadi
        ? (estimate.total_sparepart ?? estimate.totalSparepart ?? 0)
        : (estimate.bengkel_sparepart_total ?? 0);
    const sparepartAmount = Math.max(0, angka(sparepartSource));
    const jasaLainAmount = Math.max(0, angka(umumPribadi ? estimate.total_jasa_lain : body.jasa_lain_amount));
    const ppnPercentRaw = angka(body.ppn_percent);
    const ppnPercent = [0, 10, 11].includes(ppnPercentRaw) ? ppnPercentRaw : 0;
    const ppnType = ["NONE", "COMPLETE", "SPAREPART_JASA"].includes(teks(body.ppn_type).toUpperCase())
        ? teks(body.ppn_type).toUpperCase() : "SPAREPART_JASA";

    // Mengikuti format Kuitansi Perbaikan: dasar PPN untuk
    // "Sparepart dan Jasa" menampilkan Parts + Labour (Material).
    let ppnBase = 0;
    if (ppnType === "SPAREPART_JASA") ppnBase = sparepartAmount + materialAmount + labourAmount;
    else if (ppnType === "COMPLETE") ppnBase = sparepartAmount + materialAmount + labourAmount + jasaLainAmount;
    const ppnAmount = ppnBase * ppnPercent / 100;
    const totalBeforeDeductions = sparepartAmount + materialAmount + labourAmount + jasaLainAmount + ppnAmount;
    const pphPercent = 2;
    const pphAmount = labourAmount * pphPercent / 100;
    // OR selalu mengambil nilai asli dari Estimasi, bukan pembayaran OR.
    const ownRisk = Math.max(0, angka(estimate.own_risk));
    const salvageAmount = Math.max(0, angka(body.salvage_amount));
    const systemFee = Math.max(0, angka(body.system_fee));
    const grandTotal = Math.max(0, totalBeforeDeductions - ownRisk - salvageAmount - pphAmount - systemFee);

    return {
        total_jasa_perbaikan: totalJasaPerbaikan,
        material_percent: materialPercent,
        labour_percent: labourPercent,
        material_amount: materialAmount,
        labour_amount: labourAmount,
        sparepart_amount: sparepartAmount,
        jasa_lain_amount: jasaLainAmount,
        ppn_percent: ppnPercent,
        ppn_type: ppnType,
        ppn_base: ppnBase,
        ppn_amount: ppnAmount,
        pph_percent: pphPercent,
        pph_amount: pphAmount,
        own_risk: ownRisk,
        salvage_amount: salvageAmount,
        system_fee: systemFee,
        total_before_deductions: totalBeforeDeductions,
        grand_total: grandTotal,
        payable_percent: 100
    };
}

app.get("/api/document-history/:type/:id", (req,res) => {
    try {
        const type=String(req.params.type||"").trim().toUpperCase(); const id=Number(req.params.id);
        if(!type || !idValid(id)) return res.status(400).json({success:false,message:"Dokumen tidak valid."});
        const where = currentRoleCode(req)==="SUPER ADMIN" ? "" : " AND dh.workshop_id = ?";
        const params = currentRoleCode(req)==="SUPER ADMIN" ? [type,id] : [type,id,Number(req.user.workshop_id||0)];
        const rows=db.prepare(`SELECT dh.*,COALESCE(u.full_name,u.username) AS created_by_name FROM document_history dh LEFT JOIN users u ON u.id=dh.created_by WHERE dh.document_type=? AND dh.document_id=? AND UPPER(COALESCE(dh.action,''))='REVISION'${where} ORDER BY dh.id DESC`).all(...params);
        const history=rows.map(r=>{
            let changes=[];
            try {
                const parsed=JSON.parse(r.changes_json||"[]");
                changes=Array.isArray(parsed)?parsed:[];
            } catch (_) { changes=[]; }
            return {...r,changes};
        });
        const revisionCount=history.length;
        res.json({success:true,data:{history,revision_count:revisionCount}});
    } catch(error) { console.error("GET DOCUMENT HISTORY ERROR:",error); res.status(500).json({success:false,message:error.message||"Gagal mengambil riwayat dokumen."}); }
});

app.post("/api/document-history/:type/:id/print", (req,res) => {
    try {
        const type=String(req.params.type||"").trim().toUpperCase(); const id=Number(req.params.id);
        if(!type || !idValid(id)) return res.status(400).json({success:false,message:"Dokumen tidak valid."});
        const docTable = type === "TAGIHAN_KUITANSI" ? "tagihan_kuitansi" : (type === "WO" ? "wo" : (type === "ESTIMASI" ? "estimates" : null));
        if(!docTable) return res.status(400).json({success:false,message:"Jenis dokumen belum didukung."});
        const row=db.prepare(`SELECT id,workshop_id FROM ${docTable} WHERE id=? LIMIT 1`).get(id);
        if(!row) return res.status(404).json({success:false,message:"Dokumen tidak ditemukan."});
        if(currentRoleCode(req)!=="SUPER ADMIN" && Number(row.workshop_id||0)!==Number(req.user.workshop_id||0)) return res.status(403).json({success:false,message:"Dokumen bukan bagian dari bengkel Anda."});
        const count=db.prepare(`SELECT COUNT(*) AS n FROM document_history WHERE document_type=? AND document_id=? AND UPPER(action)='PRINT' AND workshop_id=?`).get(type,id,Number(row.workshop_id||req.user.workshop_id||0)).n;
        const next=Number(count||0)+1;
        db.prepare(`INSERT INTO document_history (document_type,document_id,document_number,action,created_by,workshop_id) VALUES (?,?,?,?,?,?)`).run(type,id,req.body?.document_number||null,"PRINT",auditUserId(req),Number(row.workshop_id||req.user.workshop_id||0));
        res.json({success:true,print_count:next});
    } catch(error) { console.error("POST DOCUMENT PRINT HISTORY ERROR:",error); res.status(500).json({success:false,message:error.message||"Gagal mencatat cetak dokumen."}); }
});

app.post("/api/document-history/:type/:id/revision", (req,res) => {
    try {
        const type=String(req.params.type||"").trim().toUpperCase(); const id=Number(req.params.id);
        if(!["WO","ESTIMASI"].includes(type) || !idValid(id)) return res.status(400).json({success:false,message:"Dokumen tidak valid."});
        const docTable=type==="WO"?"wo":"estimates";
        const row=db.prepare(`SELECT id,workshop_id FROM ${docTable} WHERE id=? LIMIT 1`).get(id);
        if(!row) return res.status(404).json({success:false,message:"Dokumen tidak ditemukan."});
        const workshopId=Number(row.workshop_id||0);
        if(currentRoleCode(req)!=="SUPER ADMIN" && workshopId!==Number(req.user.workshop_id||0)) return res.status(403).json({success:false,message:"Dokumen bukan bagian dari bengkel Anda."});
        const before=req.body?.before ?? null; const after=req.body?.after ?? null;
        if(before===null || after===null) return res.status(400).json({success:false,message:"Data revisi tidak lengkap."});

        const changes=[];
        const isPlainObject=value=>value!==null && typeof value==="object" && !Array.isArray(value);
        const formatHistoryValue=value=>{
            if(value===undefined || value===null || value==="") return "-";
            if(typeof value==="object") {
                try { return JSON.stringify(value); } catch (_) { return String(value); }
            }
            return String(value);
        };
        const sameValue=(a,b)=>{
            try { return JSON.stringify(a)===JSON.stringify(b); } catch (_) { return a===b; }
        };
        const collectChanges=(beforeValue,afterValue,path="")=>{
            if(sameValue(beforeValue,afterValue)) return;

            if(isPlainObject(beforeValue) || isPlainObject(afterValue)) {
                const beforeObject=isPlainObject(beforeValue)?beforeValue:{};
                const afterObject=isPlainObject(afterValue)?afterValue:{};
                const keys=[...new Set([...Object.keys(beforeObject),...Object.keys(afterObject)])];
                keys.forEach(key=>collectChanges(beforeObject[key],afterObject[key],path?`${path}.${key}`:key));
                return;
            }

            if(Array.isArray(beforeValue) || Array.isArray(afterValue)) {
                const beforeArray=Array.isArray(beforeValue)?beforeValue:[];
                const afterArray=Array.isArray(afterValue)?afterValue:[];
                const length=Math.max(beforeArray.length,afterArray.length);
                for(let index=0; index<length; index++) {
                    collectChanges(beforeArray[index],afterArray[index],`${path}.${index}`);
                }
                return;
            }

            changes.push({
                field:path,
                before:formatHistoryValue(beforeValue),
                after:formatHistoryValue(afterValue)
            });
        };
        collectChanges(before,after);
        if(!changes.length){
            return res.json({success:true,recorded:false,changes:[],message:"Tidak ada perubahan yang dilakukan."});
        }
        db.prepare(`INSERT INTO document_history (document_type,document_id,document_number,action,changes_json,before_json,after_json,created_by,workshop_id) VALUES (?,?,?,?,?,?,?,?,?)`).run(type,id,req.body?.document_number||null,"REVISION",JSON.stringify(changes),JSON.stringify(before),JSON.stringify(after),auditUserId(req),workshopId);
        res.json({success:true,recorded:true,changes});
    } catch(error) { console.error("POST DOCUMENT REVISION HISTORY ERROR:",error); res.status(500).json({success:false,message:error.message||"Gagal mencatat revisi dokumen."}); }
});

app.get("/api/tagihan-kuitansi", (req, res) => {
    try {
        const data = db.prepare(`
            SELECT w.id AS wo_id, w.workshop_id AS workshop_id, w.wo_number, w.status AS wo_status, w.check_in_at, w.check_out_at, w.first_check_out_at,
                   e.id AS estimate_id, e.estimate_number, e.estimate_date, e.material_percent,
                   e.total_sparepart, e.total_jasa, e.total_jasa_lain,
                   COALESCE((SELECT SUM(es.total_price) FROM estimate_spareparts es WHERE es.estimate_id=e.id AND es.workshop_id=w.workshop_id AND UPPER(TRIM(COALESCE(es.supply_bengkel,'BENGKEL')))='BENGKEL'),0) AS bengkel_sparepart_total,
                   e.labour_percent AS estimate_labour_percent, e.own_risk,
                   c.customer_code, c.name AS customer_name, c.phone AS customer_phone,
                   i.code AS insurer_code, i.name AS insurer_name, i.address AS insurer_address,
                   i.alias AS insurer_alias,
                   tk.claim_number, tk.polis_number,
                   v.plate_number, v.brand, v.model, v.year, v.color, v.vin_number, v.engine_number,
                   tk.id AS kuitansi_id, tk.kuitansi_number, tk.total_jasa_perbaikan, tk.material_amount, tk.labour_amount,
                   tk.sparepart_amount, tk.jasa_lain_amount, tk.ppn_percent, tk.ppn_type, tk.ppn_base,
                   tk.ppn_amount, tk.pph_percent, tk.pph_amount, tk.salvage_amount, tk.system_fee,
                   tk.total_before_deductions, tk.grand_total, tk.payable_percent,
                   tk.created_at AS kuitansi_created_at, tk.updated_at AS kuitansi_updated_at,
                   COALESCE((SELECT SUM(p.amount) FROM own_risk_payments p WHERE p.wo_id = w.id AND p.workshop_id = w.workshop_id),0) AS or_paid
            FROM wo w
            INNER JOIN estimates e ON e.id = w.estimate_id
            INNER JOIN customers c ON c.id = e.customer_id
            INNER JOIN vehicles v ON v.id = e.vehicle_id
            LEFT JOIN insurers i ON i.id = e.insurer_id
            LEFT JOIN tagihan_kuitansi tk ON tk.wo_id = w.id AND tk.workshop_id = w.workshop_id
            WHERE w.workshop_id = ? AND e.workshop_id = w.workshop_id AND c.workshop_id = w.workshop_id AND v.workshop_id = w.workshop_id
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND v.workshop_id = w.workshop_id
              AND (UPPER(TRIM(COALESCE(w.status, ''))) IN ('SELESAI', 'CHECK OUT')
               OR w.first_check_out_at IS NOT NULL
               OR EXISTS (SELECT 1 FROM wo_process_history h WHERE h.wo_id = w.id AND h.workshop_id = w.workshop_id AND UPPER(TRIM(h.status)) = 'CHECK OUT'))
            ORDER BY w.id DESC
        `).all(Number(req.user?.workshop_id||0));
        const normalized = data.map(row => {
            const ownRisk = Math.max(0, angka(row.own_risk));
            const paid = Math.max(0, angka(row.or_paid));
            const bengkelPO = cekPOBengkelUntukKuitansi(row.wo_id, row.estimate_id, Number(req.user?.workshop_id || 0));
            return {...row, kuitansi_number: row.kuitansi_number || (row.kuitansi_id ? generateKuitansiNumber(row.workshop_id || req.user?.workshop_id, row.kuitansi_id) : null), own_risk: ownRisk, or_paid: paid,
                or_remaining: Math.max(0, ownRisk-paid),
                or_status: ownRisk <= 0 ? "TIDAK ADA OR" : (paid >= ownRisk ? "LUNAS" : "BELUM LUNAS"),
                kuitansi_status: row.kuitansi_id ? "SUDAH DIBUAT" : "BELUM DIBUAT",
                bengkel_po_status: bengkelPO};
        });
        res.json({success:true,data:normalized});
    } catch(error) {
        console.error("GET TAGIHAN KUITANSI ERROR:",error);
        res.status(500).json({success:false,message:error.message||"Gagal mengambil Tagihan Kuitansi."});
    }
});

app.get("/api/tagihan-kuitansi/:woId", (req,res) => {
    try {
        const woId=Number(req.params.woId);
        if(!idValid(woId)) return res.status(400).json({success:false,message:"ID WO tidak valid."});
        const row=db.prepare(`
            SELECT w.id AS wo_id,w.wo_number,w.status AS wo_status,w.check_in_at,w.check_out_at,w.first_check_out_at,
                   e.id AS estimate_id,e.estimate_number,e.estimate_date,e.material_percent,
                   e.total_sparepart,e.total_jasa,e.total_jasa_lain,e.own_risk,
                   e.claim_number AS estimate_claim_number,e.polis_number AS estimate_polis_number,
                   c.customer_code,c.name AS customer_name,c.phone AS customer_phone,
                   i.code AS insurer_code,i.name AS insurer_name,i.address AS insurer_address,
                   i.alias AS insurer_alias,
                   v.plate_number,v.brand,v.model,v.year,v.color,v.vin_number,v.engine_number,
                   tk.*,
                   w.id AS wo_id, w.wo_number AS wo_number, w.status AS wo_status, w.check_out_at AS check_out_at,
                   e.id AS estimate_id, e.estimate_number AS estimate_number, e.estimate_date AS estimate_date, e.material_percent AS material_percent, e.own_risk AS own_risk,
                   COALESCE((SELECT SUM(es.total_price) FROM estimate_spareparts es WHERE es.estimate_id=e.id AND es.workshop_id=w.workshop_id AND UPPER(TRIM(COALESCE(es.supply_bengkel,'BENGKEL')))='BENGKEL'),0) AS bengkel_sparepart_total,
                   c.customer_code AS customer_code, c.name AS customer_name, c.phone AS customer_phone,
                   i.code AS insurer_code, i.name AS insurer_name, v.plate_number AS plate_number, v.brand AS brand, v.model AS model, v.year AS year, v.color AS color, v.vin_number AS vin_number, v.engine_number AS engine_number,
                   i.alias AS insurer_alias,
                   COALESCE((SELECT SUM(p.amount) FROM own_risk_payments p WHERE p.wo_id=w.id AND p.workshop_id=w.workshop_id),0) AS or_paid
            FROM wo w INNER JOIN estimates e ON e.id=w.estimate_id
            INNER JOIN customers c ON c.id=e.customer_id
            INNER JOIN vehicles v ON v.id=e.vehicle_id
            LEFT JOIN insurers i ON i.id=e.insurer_id
            LEFT JOIN tagihan_kuitansi tk ON tk.wo_id=w.id AND tk.workshop_id=w.workshop_id
            WHERE w.id=? AND w.workshop_id=? AND e.workshop_id=w.workshop_id AND c.workshop_id=w.workshop_id AND v.workshop_id=w.workshop_id AND (UPPER(TRIM(COALESCE(w.status, ''))) IN ('SELESAI', 'CHECK OUT') OR w.first_check_out_at IS NOT NULL OR EXISTS (SELECT 1 FROM wo_process_history h WHERE h.wo_id=w.id AND h.workshop_id=w.workshop_id AND UPPER(TRIM(h.status))='CHECK OUT')) LIMIT 1
        `).get(woId, Number(req.user?.workshop_id||0));
        if(!row) return res.status(404).json({success:false,message:"WO CHECK OUT tidak ditemukan."});
        const ownRisk=Math.max(0,angka(row.own_risk)); const paid=Math.max(0,angka(row.or_paid));
        row.own_risk=ownRisk; row.or_paid=paid; row.or_remaining=Math.max(0,ownRisk-paid);
        // No. Referensi Asuransi dan No. Polis wajib mengambil sumber dari Estimasi.
        // Data kuitansi lama yang kosong tetap akan menampilkan data Estimasi saat diprint.
        row.claim_number = teks(row.estimate_claim_number) || teks(row.claim_number);
        row.polis_number = teks(row.estimate_polis_number) || teks(row.polis_number);

        // Perbaiki nilai Parts pada kuitansi lama yang tersimpan 0/tidak sesuai.
        // Nilai Parts dikunci mengikuti Estimasi, tetapi tetap wajib masuk ke
        // total cetak dan semua perhitungan turunannya.
        const savedKuitansiId = row.kuitansi_id ?? row.id;
        const expectedParts = Math.max(0, angka(isAsuransiUmumPribadi(row.insurer_name)
            ? row.total_sparepart
            : row.bengkel_sparepart_total));
        if (savedKuitansiId && expectedParts > 0 && Math.abs(angka(row.sparepart_amount) - expectedParts) > 0.0001) {
            const ppnPercent = Math.max(0, angka(row.ppn_percent));
            const ppnType = teks(row.ppn_type || "SPAREPART_JASA").toUpperCase();
            const materialAmount = Math.max(0, angka(row.material_amount));
            const labourAmount = Math.max(0, angka(row.labour_amount));
            const jasaLainAmount = Math.max(0, angka(row.jasa_lain_amount));
            const ppnBase = ppnType === "NONE" ? 0
                : ppnType === "COMPLETE" ? expectedParts + materialAmount + labourAmount + jasaLainAmount
                : expectedParts + materialAmount + labourAmount;
            const ppnAmount = ppnBase * ppnPercent / 100;
            const pphPercent = 2;
            const pphAmount = labourAmount * pphPercent / 100;
            const totalBefore = expectedParts + materialAmount + labourAmount + jasaLainAmount + ppnAmount;
            const grandTotal = Math.max(0, totalBefore - ownRisk - Math.max(0, angka(row.salvage_amount)) - pphAmount - Math.max(0, angka(row.system_fee)));
            db.prepare(`UPDATE tagihan_kuitansi SET sparepart_amount=?,ppn_base=?,ppn_amount=?,pph_percent=?,pph_amount=?,total_before_deductions=?,grand_total=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workshop_id=?`)
                .run(expectedParts, ppnBase, ppnAmount, pphPercent, pphAmount, totalBefore, grandTotal, savedKuitansiId, Number(req.user?.workshop_id || 0));
            row.sparepart_amount = expectedParts;
            row.ppn_base = ppnBase;
            row.ppn_amount = ppnAmount;
            row.pph_percent = pphPercent;
            row.pph_amount = pphAmount;
            row.total_before_deductions = totalBefore;
            row.grand_total = grandTotal;
        }
        row.or_status=ownRisk<=0?"TIDAK ADA OR":(paid>=ownRisk?"LUNAS":"BELUM LUNAS");
        row.bengkel_po_status = cekPOBengkelUntukKuitansi(row.wo_id, row.estimate_id, Number(req.user?.workshop_id || 0));
        res.json({success:true,data:row});
    } catch(error) {
        console.error("GET DETAIL TAGIHAN KUITANSI ERROR:",error);
        res.status(500).json({success:false,message:error.message||"Gagal mengambil detail Tagihan Kuitansi."});
    }
});

app.post("/api/tagihan-kuitansi", (req,res) => {
    try {
        const woId=Number(req.body?.wo_id);
        if(!idValid(woId)) return res.status(400).json({success:false,message:"WO tidak valid."});
        const wo=db.prepare(`SELECT w.id AS wo_id,w.wo_number,w.status AS wo_status,e.* FROM wo w INNER JOIN estimates e ON e.id=w.estimate_id WHERE w.id=? AND w.workshop_id=? AND e.workshop_id=w.workshop_id LIMIT 1`).get(woId, Number(req.user?.workshop_id||0));
        if(!wo) return res.status(404).json({success:false,message:"WO tidak ditemukan."});
        const existing=db.prepare(`SELECT id FROM tagihan_kuitansi WHERE wo_id=? AND workshop_id=?`).get(woId, Number(req.user?.workshop_id||0));
        const hasCheckoutHistory=!!db.prepare(`SELECT 1 FROM wo_process_history WHERE wo_id=? AND workshop_id=? AND UPPER(status)='CHECK OUT' LIMIT 1`).get(woId, Number(req.user?.workshop_id||0));
        if(String(wo.wo_status||"").toUpperCase()!=="CHECK OUT" && !existing && !hasCheckoutHistory) return res.status(400).json({success:false,message:"Tagihan Kuitansi hanya dapat dibuat setelah WO CHECK OUT pertama kali."});
        wo.bengkel_sparepart_total = db.prepare(`SELECT COALESCE(SUM(es.total_price),0) AS total FROM estimate_spareparts es WHERE es.estimate_id=? AND es.workshop_id=? AND UPPER(TRIM(COALESCE(es.supply_bengkel,'BENGKEL')))='BENGKEL'`).get(wo.estimate_id, Number(req.user?.workshop_id || 0))?.total || 0;
        const poStatus = cekPOBengkelUntukKuitansi(woId, wo.estimate_id, Number(req.user?.workshop_id || 0));
        if (poStatus.required && !poStatus.ready) {
            const detail = poStatus.missing.length
                ? ` (${poStatus.missing.join(", ")})`
                : "";
            return res.status(400).json({
                success: false,
                message: `Tagihan Kuitansi belum dapat dibuat. Purchase Order sparepart BENGKEL belum dibuat${detail}.`
            });
        }
        const calc=hitungTagihanKuitansi(req.body,wo);
        const createdBy=auditUserId(req);
                // Simpan Kuitansi dan pindahkan Estimasi ke SELESAI dalam satu transaksi.
        // Dengan demikian tidak ada kondisi Kuitansi tersimpan tetapi Estimasi belum pindah.
        const saveTx = db.transaction(() => {
            if(existing){
                db.prepare(`UPDATE tagihan_kuitansi SET total_jasa_perbaikan=?,material_percent=?,labour_percent=?,material_amount=?,labour_amount=?,sparepart_amount=?,jasa_lain_amount=?,ppn_percent=?,ppn_type=?,ppn_base=?,ppn_amount=?,pph_percent=?,pph_amount=?,own_risk=?,salvage_amount=?,system_fee=?,total_before_deductions=?,grand_total=?,payable_percent=?,claim_number=?,polis_number=?,bank_account_id=?,bank_name=?,bank_account_number=?,bank_account_name=?,updated_at=CURRENT_TIMESTAMP WHERE wo_id=? AND workshop_id=?`).run(
                    calc.total_jasa_perbaikan,calc.material_percent,calc.labour_percent,calc.material_amount,calc.labour_amount,calc.sparepart_amount,calc.jasa_lain_amount,calc.ppn_percent,calc.ppn_type,calc.ppn_base,calc.ppn_amount,calc.pph_percent,calc.pph_amount,calc.own_risk,calc.salvage_amount,calc.system_fee,calc.total_before_deductions,calc.grand_total,calc.payable_percent,teks(wo.claim_number),teks(wo.polis_number),teks(req.body?.bank_account?.id),teks(req.body?.bank_account?.bank),teks(req.body?.bank_account?.account_number),teks(req.body?.bank_account?.account_name),woId,Number(req.user?.workshop_id||0));
            }else{
                db.prepare(`INSERT INTO tagihan_kuitansi (wo_id,total_jasa_perbaikan,material_percent,labour_percent,material_amount,labour_amount,sparepart_amount,jasa_lain_amount,ppn_percent,ppn_type,ppn_base,ppn_amount,pph_percent,pph_amount,own_risk,salvage_amount,system_fee,total_before_deductions,grand_total,payable_percent,claim_number,polis_number,bank_account_id,bank_name,bank_account_number,bank_account_name,created_by,workshop_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
                    woId,calc.total_jasa_perbaikan,calc.material_percent,calc.labour_percent,calc.material_amount,calc.labour_amount,calc.sparepart_amount,calc.jasa_lain_amount,calc.ppn_percent,calc.ppn_type,calc.ppn_base,calc.ppn_amount,calc.pph_percent,calc.pph_amount,calc.own_risk,calc.salvage_amount,calc.system_fee,calc.total_before_deductions,calc.grand_total,calc.payable_percent,teks(wo.claim_number),teks(wo.polis_number),teks(req.body?.bank_account?.id),teks(req.body?.bank_account?.bank),teks(req.body?.bank_account?.account_number),teks(req.body?.bank_account?.account_name),createdBy,Number(req.user?.workshop_id||0));
            }
            // Sumber Estimasi untuk Kuitansi langsung menjadi Estimasi Selesai.
            db.prepare(`UPDATE estimates SET status='SELESAI', updated_at=CURRENT_TIMESTAMP WHERE id=? AND workshop_id=?`).run(wo.estimate_id, requestWorkshopId(req));
        });
        saveTx();
        let saved=db.prepare(`SELECT * FROM tagihan_kuitansi WHERE wo_id=? AND workshop_id=?`).get(woId, Number(req.user?.workshop_id||0));
        if (!saved.kuitansi_number) {
            const kuitansiNumber = generateKuitansiNumber(req.user?.workshop_id, saved.id);
            db.prepare(`UPDATE tagihan_kuitansi SET kuitansi_number=? WHERE id=? AND workshop_id=?`).run(kuitansiNumber, saved.id, Number(req.user?.workshop_id||0));
            saved=db.prepare(`SELECT * FROM tagihan_kuitansi WHERE id=? AND workshop_id=?`).get(saved.id, Number(req.user?.workshop_id||0));
        }
        res.status(existing?200:201).json({success:true,message:existing?"Tagihan Kuitansi berhasil diperbarui.":"Tagihan Kuitansi berhasil disimpan.",data:saved});
    }catch(error){
        console.error("SAVE TAGIHAN KUITANSI ERROR:",error);
        res.status(500).json({success:false,message:error.message||"Gagal menyimpan Tagihan Kuitansi."});
    }
});

// ============================================================
// PEMBAYARAN TAGIHAN KUITANSI
// Daftar hanya WO yang sudah memiliki Tagihan Kuitansi.
// ============================================================

app.get("/api/pembayaran", (req, res) => {
    try {
        const data = db.prepare(`
            SELECT
                w.id AS wo_id,
                w.wo_number,
                w.status AS wo_status,
                w.check_in_at,
                w.check_out_at,
                e.id AS estimate_id,
                e.estimate_number,
                e.estimate_date,
                e.claim_number AS claim_number,
                c.customer_code,
                c.name AS customer_name,
                c.phone AS customer_phone,
                i.code AS insurer_code,
                i.name AS insurer_name,
                i.alias AS insurer_alias,
                v.plate_number,
                v.brand,
                v.model,
                v.year,
                tk.id AS kuitansi_id, tk.kuitansi_number,
                tk.grand_total,
                tk.payable_percent,
                pk.id AS payment_id,
                pk.paid_at,
                pk.description AS payment_description
            FROM tagihan_kuitansi tk
            INNER JOIN wo w ON w.id = tk.wo_id
            INNER JOIN estimates e ON e.id = w.estimate_id
            INNER JOIN customers c ON c.id = e.customer_id
            INNER JOIN vehicles v ON v.id = e.vehicle_id
            LEFT JOIN insurers i ON i.id = e.insurer_id
            LEFT JOIN pembayaran_kuitansi pk ON pk.wo_id = w.id AND pk.workshop_id = w.workshop_id
            WHERE tk.workshop_id = ?
              AND w.workshop_id = tk.workshop_id
              AND e.workshop_id = w.workshop_id
              AND c.workshop_id = w.workshop_id
              AND v.workshop_id = w.workshop_id
            ORDER BY w.id DESC
        `).all(Number(req.user?.workshop_id||0));
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET PEMBAYARAN ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil daftar Pembayaran." });
    }
});

app.post("/api/pembayaran", (req, res) => {
    try {
        const woId = Number(req.body?.wo_id);
        const paidAt = String(req.body?.paid_at || req.body?.tanggal_bayar || "").trim();
        const description = String(req.body?.description || req.body?.keterangan || "").trim();
        if (!idValid(woId)) return res.status(400).json({ success: false, message: "WO tidak valid." });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) return res.status(400).json({ success: false, message: "Tanggal Bayar wajib diisi dengan format yang benar." });

        const workshopId = Number(req.user?.workshop_id || 0);
        if (!Number.isInteger(workshopId) || workshopId <= 0) {
            return res.status(400).json({ success: false, message: "Bengkel aktif tidak valid." });
        }

        // Validasi kuitansi dan WO dalam bengkel aktif. Query memiliki dua
        // placeholder, sehingga keduanya wajib menerima nilai parameter.
        const row = db.prepare(`
            SELECT tk.id AS kuitansi_id, tk.wo_id, tk.grand_total, w.wo_number
            FROM tagihan_kuitansi tk
            INNER JOIN wo w ON w.id = tk.wo_id AND w.workshop_id = tk.workshop_id
            WHERE tk.wo_id = ? AND tk.workshop_id = ? LIMIT 1
        `).get(woId, workshopId);
        if (!row) return res.status(404).json({ success: false, message: "WO belum memiliki Tagihan Kuitansi." });

        const createdBy = auditUserId(req);
        const existing = db.prepare(`SELECT id FROM pembayaran_kuitansi WHERE wo_id = ? AND workshop_id = ? LIMIT 1`).get(woId, workshopId);
        if (existing) {
            db.prepare(`UPDATE pembayaran_kuitansi SET paid_at = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE wo_id = ? AND workshop_id = ?`)
                .run(paidAt, description || null, woId, workshopId);
        } else {
            db.prepare(`INSERT INTO pembayaran_kuitansi (wo_id, paid_at, description, created_by, workshop_id) VALUES (?, ?, ?, ?, ?)`)
                .run(woId, paidAt, description || null, createdBy, workshopId);
        }

        const saved = db.prepare(`SELECT id AS payment_id, wo_id, paid_at, description AS payment_description, created_at, updated_at FROM pembayaran_kuitansi WHERE wo_id = ? AND workshop_id = ?`).get(woId, workshopId);
        res.status(existing ? 200 : 201).json({
            success: true,
            message: existing ? "Pembayaran berhasil diperbarui." : "Pembayaran berhasil disimpan.",
            data: { ...saved, kuitansi_id: row.kuitansi_id, grand_total: row.grand_total, wo_number: row.wo_number }
        });
    } catch (error) {
        console.error("SAVE PEMBAYARAN ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal menyimpan Pembayaran." });
    }
});

// ============================================================
// STOK SPAREPART - BARANG MASUK
// ============================================================

app.get("/api/stok-sparepart", (req, res) => {
    try {
        const data = db.prepare(`
            SELECT
                id,
                entry_date,
                part_number,
                part_name,
                quantity,
                unit,
                purchase_price,
                supplier,
                vehicle_brand,
                vehicle_type,
                vehicle_year,
                notes,
                created_at,
                updated_at
            FROM sparepart_stock_in
            WHERE workshop_id = ?
            ORDER BY id DESC
        `).all(requestWorkshopId(req));
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET STOK SPAREPART ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil data Stok Sparepart." });
    }
});

app.post("/api/stok-sparepart/barang-masuk", (req, res) => {
    try {
        const entryDate = String(req.body?.entry_date || req.body?.tanggal || "").trim();
        const partNumber = String(req.body?.part_number || req.body?.kode || "").trim();
        const partName = String(req.body?.part_name || req.body?.nama || "").trim();
        const quantity = angka(req.body?.quantity || req.body?.qty);
        const unit = String(req.body?.unit || "PCS").trim() || "PCS";
        const purchasePrice = angka(req.body?.purchase_price || req.body?.harga_beli);
        const supplier = String(req.body?.supplier || "").trim();
        const vehicleBrand = String(req.body?.vehicle_brand || req.body?.merek_mobil || "").trim();
        const vehicleType = String(req.body?.vehicle_type || req.body?.jenis_mobil || "").trim();
        const vehicleYear = String(req.body?.vehicle_year || req.body?.tahun_mobil || "").trim();
        const notes = String(req.body?.notes || req.body?.keterangan || "").trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
            return res.status(400).json({ success: false, message: "Tanggal Barang Masuk wajib diisi." });
        }
        if (!partNumber) return res.status(400).json({ success: false, message: "Kode Sparepart wajib diisi." });
        if (!partName) return res.status(400).json({ success: false, message: "Nama Sparepart wajib diisi." });
        if (!(quantity > 0)) return res.status(400).json({ success: false, message: "Jumlah Barang Masuk harus lebih dari 0." });

        const createdBy = auditUserId(req);
        const result = db.prepare(`
            INSERT INTO sparepart_stock_in
            (entry_date, part_number, part_name, quantity, unit, purchase_price, supplier, vehicle_brand, vehicle_type, vehicle_year, notes, created_by, workshop_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(entryDate, partNumber, partName, quantity, unit, purchasePrice, supplier || null, vehicleBrand || null, vehicleType || null, vehicleYear || null, notes || null, createdBy, requestWorkshopId(req));

        const saved = db.prepare(`SELECT * FROM sparepart_stock_in WHERE id = ? AND workshop_id = ?`).get(result.lastInsertRowid, requestWorkshopId(req));
        res.status(201).json({ success: true, message: "Barang Masuk berhasil disimpan.", data: saved });
    } catch (error) {
        console.error("SAVE BARANG MASUK ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal menyimpan Barang Masuk." });
    }
});

app.delete("/api/stok-sparepart/barang-masuk/:id", (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!idValid(id)) return res.status(400).json({ success: false, message: "Data Barang Masuk tidak valid." });
        const result = db.prepare(`DELETE FROM sparepart_stock_in WHERE id = ? AND workshop_id = ?`).run(id, requestWorkshopId(req));
        if (!result.changes) return res.status(404).json({ success: false, message: "Data Barang Masuk tidak ditemukan." });
        res.json({ success: true, message: "Data Barang Masuk berhasil dihapus." });
    } catch (error) {
        console.error("DELETE BARANG MASUK ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal menghapus Barang Masuk." });
    }
});

app.get("/api/stok-sparepart/barang-keluar", (req, res) => {
    try {
        const data = db.prepare(`
            SELECT
                id,
                exit_date,
                part_number,
                part_name,
                quantity,
                unit,
                purchase_price,
                supplier,
                vehicle_brand,
                vehicle_type,
                vehicle_year,
                reference,
                notes,
                created_at,
                updated_at
            FROM sparepart_stock_out
            WHERE workshop_id = ?
            ORDER BY id DESC
        `).all(requestWorkshopId(req));
        res.json({ success: true, data });
    } catch (error) {
        console.error("GET BARANG KELUAR ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal mengambil data Barang Keluar." });
    }
});

app.post("/api/stok-sparepart/barang-keluar", (req, res) => {
    try {
        const exitDate = String(req.body?.exit_date || req.body?.tanggal || "").trim();
        const partNumber = String(req.body?.part_number || req.body?.kode || "").trim();
        const partName = String(req.body?.part_name || req.body?.nama || "").trim();
        const quantity = angka(req.body?.quantity || req.body?.qty);
        const unit = String(req.body?.unit || "PCS").trim() || "PCS";
        const purchasePrice = angka(req.body?.purchase_price || req.body?.harga_beli);
        const supplier = String(req.body?.supplier || "").trim();
        const vehicleBrand = String(req.body?.vehicle_brand || req.body?.merek_mobil || "").trim();
        const vehicleType = String(req.body?.vehicle_type || req.body?.jenis_mobil || "").trim();
        const vehicleYear = String(req.body?.vehicle_year || req.body?.tahun_mobil || "").trim();
        const reference = String(req.body?.reference || req.body?.referensi || "").trim();
        const notes = String(req.body?.notes || req.body?.keterangan || "").trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(exitDate)) return res.status(400).json({ success: false, message: "Tanggal Barang Keluar wajib diisi." });
        if (!partNumber) return res.status(400).json({ success: false, message: "Kode Sparepart wajib diisi." });
        if (!partName) return res.status(400).json({ success: false, message: "Nama Sparepart wajib diisi." });
        if (!(quantity > 0)) return res.status(400).json({ success: false, message: "Jumlah Barang Keluar harus lebih dari 0." });

        const stockIn = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS total FROM sparepart_stock_in WHERE part_number = ? AND workshop_id = ?`).get(partNumber, requestWorkshopId(req));
        const stockOut = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS total FROM sparepart_stock_out WHERE part_number = ? AND workshop_id = ?`).get(partNumber, requestWorkshopId(req));
        const available = Number(stockIn?.total || 0) - Number(stockOut?.total || 0);
        if (quantity > available + 1e-9) {
            return res.status(400).json({ success: false, message: `Stok ${partNumber} tidak mencukupi. Stok tersedia: ${available}.` });
        }

        const createdBy = auditUserId(req);
        const result = db.prepare(`
            INSERT INTO sparepart_stock_out
            (exit_date, part_number, part_name, quantity, unit, purchase_price, supplier, vehicle_brand, vehicle_type, vehicle_year, reference, notes, created_by, workshop_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(exitDate, partNumber, partName, quantity, unit, purchasePrice, supplier || null, vehicleBrand || null, vehicleType || null, vehicleYear || null, reference || null, notes || null, createdBy, requestWorkshopId(req));

        const saved = db.prepare(`SELECT * FROM sparepart_stock_out WHERE id = ? AND workshop_id = ?`).get(result.lastInsertRowid, requestWorkshopId(req));
        res.status(201).json({ success: true, message: "Barang Keluar berhasil disimpan.", data: saved });
    } catch (error) {
        console.error("SAVE BARANG KELUAR ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal menyimpan Barang Keluar." });
    }
});

app.delete("/api/stok-sparepart/barang-keluar/:id", (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!idValid(id)) return res.status(400).json({ success: false, message: "Data Barang Keluar tidak valid." });
        const result = db.prepare(`DELETE FROM sparepart_stock_out WHERE id = ? AND workshop_id = ?`).run(id, requestWorkshopId(req));
        if (!result.changes) return res.status(404).json({ success: false, message: "Data Barang Keluar tidak ditemukan." });
        res.json({ success: true, message: "Data Barang Keluar berhasil dihapus." });
    } catch (error) {
        console.error("DELETE BARANG KELUAR ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal menghapus Barang Keluar." });
    }
});

// ============================================================
// BILLING - INPUT PEMAKAIAN BAHAN
// ============================================================
const MATERIAL_USAGE_MASTER = [
    { code: "AMPLAS", name: "Amplas", mode: "select", options: ["Amplas 80", "Amplas 120", "Amplas 220", "Amplas 320", "Amplas 400", "Amplas 500", "Amplas 1000", "Amplas 1500", "Amplas 200"] },
    { code: "DEMPUL", name: "Dempul", mode: "brand" },
    { code: "EFOXY", name: "Efoxy", mode: "brand" },
    { code: "LEM_KERTAS", name: "Lem Kertas", mode: "brand" },
    { code: "THINER_PU", name: "Thiner PU", mode: "brand" },
    { code: "THINER_DESGRESER", name: "Thiner DESGRESER", mode: "brand" },
    { code: "THINER_ND_HG", name: "Thiner ND / HG", mode: "brand" },
    { code: "THINER_EXTRASLOW", name: "Thiner EXTRASLOW", mode: "brand" },
    { code: "VERNIS", name: "Vernis", mode: "brand" },
    { code: "CAT", name: "Cat", mode: "brand" },
    { code: "CAT_HITAM_DOFF", name: "Cat Hitam Doff", mode: "brand" },
    { code: "CAT_HITAM_KILAT", name: "Cat Hitam Kilat", mode: "brand" },
    { code: "COUMPOUND_PUTIH_RUBBING", name: "Coumpound Putih Rubbing", mode: "brand" },
    { code: "COUMPOUND_COKELAT", name: "Coumpound Cokelat", mode: "brand" },
    { code: "MIPA_POLISHING", name: "Mipa Polishing", mode: "brand" },
    { code: "CARLAK_LIQUID", name: "Carlak / Liquid", mode: "brand" },
    { code: "PAD_GLAZE", name: "Pad Glaze", mode: "brand" },
    { code: "ISOLASI", name: "Isolasi", mode: "brand" },
    { code: "KORAN_PLASTIK_CAT", name: "Koran / Pelastik Cat", mode: "brand" },
    { code: "SABUN", name: "Sabun", mode: "brand" },
    { code: "SHAMPO", name: "Shampo", mode: "brand" },
    { code: "WOOL_POLES", name: "Wool Poles", mode: "brand" },
    { code: "BIAYA_SURVEY", name: "Biaya Survey", mode: "name" },
    { code: "KOMISI_AGENT", name: "Komisi Agent", mode: "name" }
];

app.get("/api/pemakaian-bahan", (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT
                w.id,
                w.wo_number,
                w.status,
                w.created_at,
                w.check_in_at,
                e.estimate_number,
                e.agent,
                c.name AS customer_name,
                v.plate_number,
                v.brand,
                v.model,
                v.year,
                v.color,
                COALESCE(SUM(mu.total), 0) AS material_total,
                COUNT(mu.id) AS material_count
            FROM wo w
            LEFT JOIN estimates e ON e.id = w.estimate_id
            LEFT JOIN customers c ON c.id = e.customer_id
            LEFT JOIN vehicles v ON v.id = e.vehicle_id
            LEFT JOIN material_usage mu ON mu.wo_id = w.id
            WHERE w.workshop_id = ?
            GROUP BY w.id
            ORDER BY w.id DESC
        `).all(requestWorkshopId(req));

        const stmt = db.prepare(`
            SELECT id, wo_id, material_code, material_name, brand_name, quantity, unit_price, total, created_by, created_at, updated_at
            FROM material_usage
            WHERE wo_id = ? AND workshop_id = ?
            ORDER BY id ASC
        `);
        rows.forEach(row => { row.material_usage = stmt.all(row.id, requestWorkshopId(req)); });
        res.json({ success: true, data: rows, master: MATERIAL_USAGE_MASTER });
    } catch (error) {
        console.error("GET PEMAKAIAN BAHAN ERROR:", error);
        res.status(500).json({ success: false, message: "Gagal mengambil data pemakaian bahan." });
    }
});

app.get("/api/pemakaian-bahan/:woId", (req, res) => {
    try {
        const woId = Number(req.params.woId);
        if (!idValid(woId)) return res.status(400).json({ success: false, message: "ID WO tidak valid." });
        const wo = db.prepare(`
            SELECT w.id, w.wo_number, w.status, w.created_at, e.estimate_number, e.agent, c.name AS customer_name,
                   v.plate_number, v.brand, v.model, v.year, v.color
            FROM wo w
            INNER JOIN estimates e ON e.id = w.estimate_id
            INNER JOIN customers c ON c.id = e.customer_id
            INNER JOIN vehicles v ON v.id = e.vehicle_id
            WHERE w.id = ? AND w.workshop_id = ? LIMIT 1
        `).get(woId, requestWorkshopId(req));
        if (!wo) return res.status(404).json({ success: false, message: "WO tidak ditemukan." });
        const data = db.prepare(`
            SELECT id, wo_id, material_code, material_name, brand_name, quantity, unit_price, total, created_by, created_at, updated_at
            FROM material_usage WHERE wo_id = ? AND workshop_id = ? ORDER BY id ASC
        `).all(woId, requestWorkshopId(req));
        res.json({ success: true, data: { wo, material_usage: data, master: MATERIAL_USAGE_MASTER } });
    } catch (error) {
        console.error("GET DETAIL PEMAKAIAN BAHAN ERROR:", error);
        res.status(500).json({ success: false, message: "Gagal mengambil detail pemakaian bahan." });
    }
});

app.post("/api/pemakaian-bahan/:woId", (req, res) => {
    try {
        const woId = Number(req.params.woId);
        if (!idValid(woId)) return res.status(400).json({ success: false, message: "ID WO tidak valid." });
        const wo = db.prepare(`SELECT id FROM wo WHERE id = ? AND workshop_id = ? LIMIT 1`).get(woId, requestWorkshopId(req));
        if (!wo) return res.status(404).json({ success: false, message: "WO tidak ditemukan." });

        const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
        const byCode = new Map(MATERIAL_USAGE_MASTER.map(item => [item.code, item]));
        const normalized = [];

        for (const item of incoming) {
            const code = teks(item?.material_code).toUpperCase();
            const master = byCode.get(code);
            if (!master) continue;
            const brandName = teks(item?.brand_name);
            const quantity = master.mode === "name" ? 1 : Number(item?.quantity);
            const unitPrice = item?.unit_price === "" || item?.unit_price === undefined || item?.unit_price === null ? 0 : Number(item?.unit_price);
            const hasInput = Boolean(brandName) || (Number.isFinite(unitPrice) && unitPrice > 0) || (master.mode !== "name" && Number.isFinite(quantity) && quantity > 0);
            if (!hasInput) continue;
            if (master.mode !== "name" && (!Number.isFinite(quantity) || quantity < 1)) {
                return res.status(400).json({ success: false, message: `${master.name}: Qty minimal 1.` });
            }
            if (!Number.isFinite(unitPrice) || unitPrice < 0) {
                return res.status(400).json({ success: false, message: `${master.name}: Harga tidak valid.` });
            }
            if ((master.mode === "select" || master.mode === "name") && !brandName) {
                return res.status(400).json({ success: false, message: `${master.name}: ${master.mode === "name" ? "Nama" : master.mode === "select" ? "pilihan" : "Merek"} wajib diisi.` });
            }
            if (master.mode === "select" && !master.options.includes(brandName)) {
                return res.status(400).json({ success: false, message: `${master.name}: pilihan tidak valid.` });
            }
            const qty = master.mode === "name" ? 1 : quantity;
            normalized.push({ code, name: master.name, brandName: brandName || null, quantity: qty, unitPrice, total: qty * unitPrice });
        }

        const userId = auditUserId(req);
        const transaction = db.transaction(() => {
            db.prepare(`DELETE FROM material_usage WHERE wo_id = ? AND workshop_id = ?`).run(woId, requestWorkshopId(req));
            const insert = db.prepare(`
                INSERT INTO material_usage (wo_id, material_code, material_name, brand_name, quantity, unit_price, total, created_by, updated_at, workshop_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
            `);
            for (const row of normalized) {
                insert.run(woId, row.code, row.name, row.brandName, row.quantity, row.unitPrice, row.total, userId, requestWorkshopId(req));
            }
        });
        transaction();

        const saved = db.prepare(`SELECT * FROM material_usage WHERE wo_id = ? AND workshop_id = ? ORDER BY id ASC`).all(woId, requestWorkshopId(req));
        res.json({ success: true, message: "Pemakaian bahan berhasil disimpan.", data: saved });
    } catch (error) {
        console.error("SAVE PEMAKAIAN BAHAN ERROR:", error);
        res.status(500).json({ success: false, message: error.message || "Gagal menyimpan pemakaian bahan." });
    }
});

// ============================================================
// VENDOR PRODUKSI / TUKANG - DAFTAR WO AKTIF
// ============================================================
app.get(
    "/api/vendor-produksi",
    (req, res) => {
        try {
            const data = db.prepare(`
                SELECT
                    w.id,
                    w.wo_number,
                    w.status,
                    w.target_date,
                    w.check_in_at,
                    w.pengerjaan_at,
                    w.selesai_at,
                    e.estimate_number,
                    c.name AS customer_name,
                    c.customer_code,
                    v.plate_number,
                    v.brand,
                    v.model,
                    v.year,
                    COALESCE(SUM(CASE WHEN UPPER(TRIM(p.worker_type)) = 'KETOK' THEN p.worker_price ELSE 0 END), 0) AS ketok_price,
                    COALESCE(SUM(CASE WHEN UPPER(TRIM(p.worker_type)) = 'DEMPUL' THEN p.worker_price ELSE 0 END), 0) AS dempul_price,
                    COALESCE(SUM(CASE WHEN UPPER(TRIM(p.worker_type)) = 'CAT' THEN p.worker_price ELSE 0 END), 0) AS cat_price,
                    COALESCE(SUM(CASE WHEN UPPER(TRIM(p.worker_type)) = 'POLES' THEN p.worker_price ELSE 0 END), 0) AS poles_price,
                    COALESCE(SUM(p.worker_price), 0) AS total_worker_price,
                    COUNT(DISTINCT CASE WHEN UPPER(TRIM(p.worker_type)) IN ('KETOK','DEMPUL','CAT','POLES') THEN UPPER(TRIM(p.worker_type)) END) AS worker_type_count,
                    vp.id AS payment_id,
                    vp.paid_at AS payment_paid_at,
                    vp.description AS payment_description
                FROM wo w
                INNER JOIN estimates e ON e.id = w.estimate_id
                INNER JOIN customers c ON c.id = e.customer_id
                INNER JOIN vehicles v ON v.id = e.vehicle_id
                LEFT JOIN production_worker_prices p ON p.wo_id = w.id
                LEFT JOIN vendor_production_payments vp ON vp.wo_id = w.id AND vp.workshop_id = w.workshop_id
                WHERE w.workshop_id = ?
                  AND e.workshop_id = w.workshop_id
                  AND c.workshop_id = w.workshop_id
                  AND v.workshop_id = w.workshop_id
                GROUP BY w.id
                ORDER BY w.id DESC
            `).all(requestWorkshopId(req));

            const workerStmt = db.prepare(`
                SELECT id, wo_id, worker_name, worker_type, worker_price, created_at, updated_at
                FROM production_worker_prices
                WHERE wo_id = ? AND workshop_id = ?
                ORDER BY CASE UPPER(TRIM(worker_type)) WHEN 'KETOK' THEN 1 WHEN 'DEMPUL' THEN 2 WHEN 'CAT' THEN 3 WHEN 'POLES' THEN 4 ELSE 9 END, id
            `);
            data.forEach(row => {
                row.worker_prices = workerStmt.all(row.id, requestWorkshopId(req));
                row.total_worker_price = row.worker_prices.reduce((sum, item) => sum + Number(item.worker_price || 0), 0);
                row.worker_type_count = new Set(
                    row.worker_prices
                        .map(item => String(item.worker_type || '').trim().toUpperCase())
                        .filter(type => ['KETOK','DEMPUL','CAT','POLES'].includes(type))
                ).size;
                row.all_worker_prices_input = row.worker_type_count === 4;
            });

            res.json({ success: true, data });
        } catch (error) {
            console.error("GET VENDOR PRODUKSI ERROR:", error);
            res.status(500).json({ success: false, message: "Gagal mengambil daftar WO Vendor Produksi." });
        }
    }
);

// ============================================================
// VENDOR PRODUKSI / TUKANG - HARGA PEKERJA
// Harga tetap dapat diinput walaupun WO sudah CHECK OUT/SELESAI,
// karena pembayaran vendor dilakukan setelah seluruh harga pekerja
// selesai diinput.
// ============================================================
app.post(
    "/api/vendor-produksi/:woId/harga",
    (req, res) => {
        try {
            const woId = Number(req.params.woId);
            const workerName = String(req.body.worker_name || "").trim();
            const workerType = String(req.body.worker_type || "").trim().toUpperCase();
            const workerPrice = Number(req.body.worker_price);

            if (!Number.isInteger(woId) || woId <= 0) {
                return res.status(400).json({ success: false, message: "ID WO tidak valid." });
            }
            if (!workerName) {
                return res.status(400).json({ success: false, message: "Nama pekerja wajib diisi." });
            }
            if (!['KETOK', 'DEMPUL', 'CAT', 'POLES'].includes(workerType)) {
                return res.status(400).json({ success: false, message: "Jenis pekerjaan harus Ketok, Dempul, Cat, atau Poles." });
            }
            if (!Number.isFinite(workerPrice) || workerPrice < 0) {
                return res.status(400).json({ success: false, message: "Harga pekerja tidak valid." });
            }

            const wo = db.prepare(`SELECT id, status FROM wo WHERE id = ? AND workshop_id = ? LIMIT 1`).get(woId, requestWorkshopId(req));
            if (!wo) {
                return res.status(404).json({ success: false, message: "WO tidak ditemukan." });
            }

            const paid = db.prepare(`SELECT id FROM vendor_production_payments WHERE wo_id = ? AND workshop_id = ? LIMIT 1`).get(woId, requestWorkshopId(req));
            if (paid) {
                return res.status(400).json({ success: false, message: "WO sudah dibayar Vendor Produksi dan tidak dapat diubah lagi." });
            }

            db.prepare(`
                INSERT INTO production_worker_prices (wo_id, worker_name, worker_type, worker_price, updated_at, workshop_id)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                ON CONFLICT(wo_id, worker_type) DO UPDATE SET
                    worker_name = excluded.worker_name,
                    worker_price = excluded.worker_price,
                    updated_at = CURRENT_TIMESTAMP
            `).run(woId, workerName, workerType, workerPrice, requestWorkshopId(req));

            const workers = db.prepare(`
                SELECT id, wo_id, worker_name, worker_type, worker_price, created_at, updated_at
                FROM production_worker_prices
                WHERE wo_id = ? AND workshop_id = ?
                ORDER BY id
            `).all(woId, requestWorkshopId(req));
            const total = workers.reduce((sum, item) => sum + Number(item.worker_price || 0), 0);
            const typeCount = new Set(workers.map(item => String(item.worker_type || '').trim().toUpperCase()).filter(type => ['KETOK','DEMPUL','CAT','POLES'].includes(type))).size;

            res.json({
                success: true,
                message: "Harga pekerja berhasil disimpan.",
                data: {
                    worker: workers.find(item => String(item.worker_type).toUpperCase() === workerType),
                    total_worker_price: total,
                    worker_type_count: typeCount,
                    all_worker_prices_input: typeCount === 4
                }
            });
        } catch (error) {
            console.error("SAVE HARGA PEKERJA ERROR:", error);
            res.status(500).json({ success: false, message: error.message || "Gagal menyimpan harga pekerja." });
        }
    }
);

// ============================================================
// VENDOR PRODUKSI - PEMBAYARAN
// Tombol pembayaran hanya boleh diproses setelah seluruh jenis
// pekerjaan (Ketok, Dempul, Cat, Poles) sudah memiliki input.
// ============================================================
app.post(
    "/api/vendor-produksi/:woId/pembayaran",
    (req, res) => {
        try {
            const woId = Number(req.params.woId);
            const paidAt = String(req.body?.paid_at || "").trim();
            const description = String(req.body?.description || "").trim();
            const createdBy = auditUserId(req);

            if (!Number.isInteger(woId) || woId <= 0) {
                return res.status(400).json({ success: false, message: "ID WO tidak valid." });
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
                return res.status(400).json({ success: false, message: "Tanggal pembayaran wajib diisi dengan format yang benar." });
            }

            const wo = db.prepare(`SELECT id, wo_number FROM wo WHERE id = ? AND workshop_id = ? LIMIT 1`).get(woId, requestWorkshopId(req));
            if (!wo) {
                return res.status(404).json({ success: false, message: "WO tidak ditemukan." });
            }

            const workers = db.prepare(`
                SELECT worker_type, worker_price
                FROM production_worker_prices
                WHERE wo_id = ? AND workshop_id = ?
            `).all(woId, requestWorkshopId(req));
            const required = ['KETOK','DEMPUL','CAT','POLES'];
            const entered = new Set(workers.map(item => String(item.worker_type || '').trim().toUpperCase()));
            const missing = required.filter(type => !entered.has(type));
            if (missing.length) {
                return res.status(400).json({
                    success: false,
                    message: `Harga pekerja belum lengkap. Belum diinput: ${missing.join(', ')}.`
                });
            }

            const total = workers.reduce((sum, item) => sum + Number(item.worker_price || 0), 0);
            if (!(total >= 0)) {
                return res.status(400).json({ success: false, message: "Total harga pekerja tidak valid." });
            }

            const existing = db.prepare(`SELECT id FROM vendor_production_payments WHERE wo_id = ? AND workshop_id = ? LIMIT 1`).get(woId, requestWorkshopId(req));
            if (existing) {
                return res.status(400).json({ success: false, message: "Pembayaran Vendor Produksi untuk WO ini sudah tersimpan." });
            }

            const result = db.prepare(`
                INSERT INTO vendor_production_payments (wo_id, paid_at, description, created_by, workshop_id)
                VALUES (?, ?, ?, ?, ?)
            `).run(woId, paidAt, description || null, createdBy, requestWorkshopId(req));

            const saved = db.prepare(`
                SELECT id AS payment_id, wo_id, paid_at, description AS payment_description, created_by, created_at, updated_at
                FROM vendor_production_payments
                WHERE id = ? AND workshop_id = ?
            `).get(result.lastInsertRowid, requestWorkshopId(req));

            res.status(201).json({
                success: true,
                message: `Pembayaran Vendor Produksi WO ${wo.wo_number || ''} berhasil disimpan.`,
                data: { ...saved, wo_number: wo.wo_number, total_worker_price: total }
            });
        } catch (error) {
            console.error("SAVE PEMBAYARAN VENDOR PRODUKSI ERROR:", error);
            res.status(500).json({ success: false, message: error.message || "Gagal menyimpan pembayaran Vendor Produksi." });
        }
    }
);


// ============================================================
// FALLBACK FRONTEND
// ============================================================

app.use(
    (req, res, next) => {

        if (
            req.method !== "GET"
        ) {

            return next();
        }


        res.sendFile(
            path.join(
                __dirname,
                "../frontend/index.html"
            )
        );
    }
);




// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
    (error, req, res, next) => {

        console.error(
            "SERVER ERROR:",
            error
        );


        if (
            res.headersSent
        ) {

            return next(error);
        }


        res
            .status(500)
            .json({

                success: false,

                message:
                    "Terjadi kesalahan pada server."

            });
    }
);


// ============================================================
// START SERVER
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");

        console.log(
            "======================================"
        );

        console.log(
            "          MYWORKSHOP SERVER"
        );

        console.log(
            "======================================"
        );

        console.log(
            `Server berjalan di port ${PORT}`
        );

        console.log(
            `Local : http://localhost:${PORT}`
        );

        console.log(
            `API   : http://localhost:${PORT}/api/status`
        );

        console.log(
            "======================================"
        );

    }
);
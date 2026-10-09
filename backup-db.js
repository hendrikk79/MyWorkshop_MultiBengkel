// ============================================================
// MYWORKSHOP - SQLITE BACKUP
// Jalankan dari folder backend:
//   node backup-db.js
// Environment:
//   MYWORKSHOP_DB_PATH  -> lokasi database aktif (opsional)
//   MYWORKSHOP_BACKUP_DIR -> folder backup (opsional)
// ============================================================

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const dbPath = path.resolve(
    process.env.MYWORKSHOP_DB_PATH || path.join(__dirname, "..", "database", "myworkshop.db")
);
const backupDir = path.resolve(
    process.env.MYWORKSHOP_BACKUP_DIR || path.join(__dirname, "..", "backups")
);

if (!fs.existsSync(dbPath)) {
    throw new Error(`Database MyWorkshop tidak ditemukan: ${dbPath}`);
}

fs.mkdirSync(backupDir, { recursive: true });

const now = new Date();
const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const destination = path.join(backupDir, `myworkshop-${stamp}.db`);

const db = new Database(dbPath, { readonly: true });

(async () => {
    try {
        await db.backup(destination);
        console.log(`Backup MyWorkshop berhasil: ${destination}`);
    } finally {
        db.close();
    }
})().catch(error => {
    console.error("BACKUP DATABASE ERROR:", error.message || error);
    process.exitCode = 1;
});

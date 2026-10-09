
// Cache browser wajib dipisahkan berdasarkan bengkel aktif. Data transaksi utama tetap berasal dari API/Central Storage.
function myWorkshopScopedStorageKey(key) {
    try {
        const user = JSON.parse(localStorage.getItem("myworkshop_user") || "null") || {};
        const wid = Number(user?.workshop_id || 0);
        return wid > 0 ? `${String(key)}__workshop_${wid}` : String(key);
    } catch (_) {
        return String(key);
    }
}
// ==========================================================
// MYWORKSHOP - TAGIHAN OWN RISK (OR)
// ==========================================================

let orData = [];
let currentPaymentWO = null;

function el(id) { return document.getElementById(id); }

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function apiRequest(url, options = {}) {
    return fetch(url, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
    }).then(async response => {
        let data = {};
        try { data = await response.json(); } catch (_) {}
        if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
        return data;
    });
}

function rupiah(value) {
    return "Rp " + Number(value || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

function formatDate(value) {
    if (!value) return "-";
    const d = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("id-ID", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

function formatDateOnly(value) {
    if (!value) return "-";
    const d = value instanceof Date
        ? value
        : new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return String(value);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function renderList() {
    const body = el("orTableBody");
    if (!body) return;
    const keyword = String(el("searchOR")?.value || "").trim().toLowerCase();
    const rows = orData.filter(row => {
        const text = [row.wo_number, row.estimate_number, row.customer_name, row.customer_code, row.plate_number, (row.insurer_alias || row.insurerAlias || row.insurer_name)].join(" ").toLowerCase();
        return !keyword || text.includes(keyword);
    });

    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="13" class="or-empty">Belum ada WO status SELESAI / CHECK OUT untuk Tagihan Own Risk (OR).</td></tr>';
        return;
    }

    body.innerHTML = rows.map((row, index) => {
        const paid = Number(row.total_paid ?? row.paid_amount ?? 0);
        const free = Number(row.free_amount || 0);
        const due = Number(row.amount_due ?? Math.max(0, Number(row.own_risk || 0) - free));
        const remaining = Number(row.remaining_amount ?? Math.max(0, due - paid));
        const lunas = remaining <= 0;
        const status = lunas ? '<span class="or-status-lunas">LUNAS</span>' : '<span class="or-status-belum">BELUM LUNAS</span>';
        return `<tr>
            <td>${index + 1}</td>
            <td><strong>${escapeHTML(row.wo_number)}</strong></td>
            <td>${escapeHTML(row.estimate_number)}</td>
            <td>${escapeHTML(row.customer_name)}</td>
            <td>${escapeHTML(row.plate_number)}</td>
            <td>${escapeHTML(row.insurer_alias || row.insurerAlias || row.insurer_name || "-")}</td>
            <td class="or-amount">${escapeHTML(rupiah(row.own_risk))}</td>
            <td class="or-amount">${escapeHTML(rupiah(free))}</td>
            <td class="or-amount">${escapeHTML(rupiah(due))}</td>
            <td class="or-amount">${escapeHTML(rupiah(paid))}</td>
            <td class="or-amount">${escapeHTML(rupiah(remaining))}</td>
            <td>${status}</td>
            <td><div class="or-actions">
                <div style="display:inline-flex;align-items:center;gap:4px;margin-right:4px;vertical-align:middle">
                    <label for="warrantyMonths_${escapeHTML(row.wo_id)}" style="font-size:11px">Garansi (bulan)</label>
                    <input id="warrantyMonths_${escapeHTML(row.wo_id)}" type="number" min="1" step="1" value="${getWarrantyMonths(row.wo_id)}" onchange="saveWarrantyMonths('${escapeHTML(row.wo_id)}', this.value)" style="width:58px;padding:4px 5px;border:1px solid #cbd5e1;border-radius:4px">
                </div>
                <button type="button" class="btn-secondary btn-small" onclick="printORTagihan('${escapeHTML(row.wo_id)}')">Print</button>
                <button type="button" class="btn-secondary btn-small" onclick="printRatingLetter('${escapeHTML(row.wo_id)}')">Ajukan Rating</button>
                <button type="button" class="btn-secondary btn-small" onclick="printWarrantyLetter('${escapeHTML(row.wo_id)}')">Surat Garansi</button>
                ${lunas ? '' : `<button type="button" class="btn-primary btn-small" onclick="openPaymentModal('${escapeHTML(row.wo_id)}')">Pembayaran</button>`}
            </div></td>
        </tr>`;
    }).join("");
}

function loadLocalJSON(key, fallback = []) {
    try {
        const raw = localStorage.getItem(key);
        const data = raw ? JSON.parse(raw) : fallback;
        return Array.isArray(data) ? data : fallback;
    } catch (e) {
        console.warn("Gagal membaca localStorage", key, e);
        return fallback;
    }
}

function saveLocalJSON(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

const OR_PAYMENT_STORAGE_KEY = myWorkshopScopedStorageKey("myworkshop_or_payments");

const OR_FIRST_PRINT_STORAGE_KEY = myWorkshopScopedStorageKey("myworkshop_or_first_print_at");
const WARRANTY_PERIOD_STORAGE_KEY = "myworkshop_or_warranty_period_months";

function getWarrantyMonths(woId) {
    try {
        const data = JSON.parse(localStorage.getItem(WARRANTY_PERIOD_STORAGE_KEY) || "{}");
        const n = Number(data[String(woId)]);
        return Number.isInteger(n) && n > 0 ? n : 3;
    } catch (_) {
        return 3;
    }
}

function saveWarrantyMonths(woId, value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return false;
    try {
        const data = JSON.parse(localStorage.getItem(WARRANTY_PERIOD_STORAGE_KEY) || "{}");
        data[String(woId)] = n;
        localStorage.setItem(WARRANTY_PERIOD_STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (_) {
        return false;
    }
}

function getFirstORPrintDate(woId) {
    try {
        const data = JSON.parse(localStorage.getItem(OR_FIRST_PRINT_STORAGE_KEY) || "{}");
        const value = data[String(woId)];
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    } catch (_) {
        return null;
    }
}

function recordFirstORPrint(woId) {
    const existing = getFirstORPrintDate(woId);
    if (existing) return existing;
    const now = new Date();
    try {
        const data = JSON.parse(localStorage.getItem(OR_FIRST_PRINT_STORAGE_KEY) || "{}");
        data[String(woId)] = now.toISOString();
        localStorage.setItem(OR_FIRST_PRINT_STORAGE_KEY, JSON.stringify(data));
    } catch (_) {}
    return now;
}

function getLocalEstimateId(wo) {
    return String(wo?.estimate_id ?? wo?.estimasiId ?? wo?.estimateId ?? "");
}

function getLocalEstimateNumber(est) {
    return String(est?.number ?? est?.estimate_number ?? est?.estimateNumber ?? est?.noEstimasi ?? "");
}

function getLocalOwnRisk(est) {
    const value = est?.ownRisk ?? est?.own_risk ?? est?.or ?? est?.OR ?? 0;
    const n = Number(String(value).replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(/,/g, "."));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function buildLocalORData() {
    const woList = loadLocalJSON(myWorkshopScopedStorageKey("myworkshop_wo"), []);
    const estimates = loadLocalJSON(myWorkshopScopedStorageKey("myworkshop_estimasi"), []);
    const payments = loadLocalJSON(OR_PAYMENT_STORAGE_KEY, []);

    const estimateMap = new Map();
    estimates.forEach(est => {
        const id = String(est?.id ?? est?.estimate_id ?? est?.estimasiId ?? "");
        if (id) estimateMap.set(id, est);
    });

    return woList
        .filter(wo => {
            const status = String(wo?.status ?? "").trim().toUpperCase();
            if (status === "SELESAI" || status === "CHECK OUT") return true;
            const history = wo?.process_history ?? wo?.processHistory ?? [];
            return Array.isArray(history) && history.some(h => String(h?.status ?? "").trim().toUpperCase() === "CHECK OUT");
        })
        .map(wo => {
            const estimate = estimateMap.get(getLocalEstimateId(wo)) || {};
            const woId = String(wo?.id ?? wo?.wo_id ?? "");
            const paid = payments
                .filter(p => String(p?.wo_id) === woId)
                .reduce((sum, p) => sum + (Number(p?.amount) || 0), 0);
            const ownRisk = getLocalOwnRisk(estimate);
            const remaining = Math.max(0, ownRisk - paid);
            const latestPayment = payments
                .filter(p => String(p?.wo_id) === woId)
                .sort((a, b) => new Date(b?.paid_at || b?.created_at || 0) - new Date(a?.paid_at || a?.created_at || 0))[0] || null;

            return {
                wo_id: woId,
                wo_number: wo?.wo_number ?? wo?.noWO ?? "",
                estimate_id: getLocalEstimateId(wo),
                estimate_number: wo?.estimate_number ?? wo?.noEstimasi ?? getLocalEstimateNumber(estimate),
                customer_code: wo?.customer_code ?? wo?.customerCode ?? estimate?.customerCode ?? "",
                customer_name: wo?.customer_name ?? wo?.customerName ?? estimate?.customerName ?? "",
                customer_phone: wo?.customer_phone ?? wo?.phone ?? estimate?.customerPhone ?? "",
                insurer_name: wo?.insurer_name ?? wo?.insurerName ?? estimate?.insurerName ?? estimate?.insurer ?? "",
                insurer_alias: wo?.insurer_alias ?? wo?.insurerAlias ?? estimate?.insurerAlias ?? estimate?.insurer_alias ?? "",
                plate_number: wo?.plate_number ?? wo?.plate ?? estimate?.plate ?? "",
                brand: wo?.brand ?? estimate?.brand ?? "",
                model: wo?.model ?? estimate?.model ?? "",
                year: wo?.year ?? estimate?.year ?? "",
                wo_status: String(wo?.status ?? "").toUpperCase(),
                check_out_at: wo?.check_out_at ?? wo?.checkOutAt ?? "",
                own_risk: ownRisk,
                paid_amount: paid,
                remaining_amount: remaining,
                payment_status: latestPayment ? "LUNAS" : "BELUM LUNAS",
                payment_description: latestPayment?.description || "",
                _local: true
            };
        })
        .filter(row => row.own_risk > 0);
}

async function loadOR() {
    try {
        const data = await apiRequest("/api/tagihan-or");
        orData = Array.isArray(data.data) ? data.data : [];
    } catch (e) {
        console.error("Gagal mengambil Tagihan OR dari database pusat:", e);
        orData = [];
    }
    renderList();
}

let currentWorkshopNamePromise = null;

async function getCurrentWorkshopName() {
    if (!currentWorkshopNamePromise) {
        currentWorkshopNamePromise = fetch("/api/workshop/current", { cache: "no-store" })
            .then(async response => {
                const json = await response.json().catch(() => ({}));
                if (!response.ok || !json.success) throw new Error(json.message || "Gagal mengambil nama bengkel.");
                return String(json.data?.name || "MyWorkshop").trim() || "MyWorkshop";
            })
            .catch(error => {
                console.error("Gagal mengambil nama bengkel:", error);
                return "MyWorkshop";
            });
    }
    return currentWorkshopNamePromise;
}

async function printORTagihan(woId) {
    const row = orData.find(x => String(x.wo_id) === String(woId));
    if (!row) return myWorkshopAlert("Data Tagihan Own Risk tidak ditemukan.");

    // Tanggal pertama kali OR diprint menjadi tanggal mulai garansi.
    recordFirstORPrint(woId);

    const paymentDescription = String(row.payment_description || "").trim();
    let orBank = { bank:"", account_number:"", account_name:"" };
    try {
        const bankRes = await fetch("/api/settings/payment-bank-accounts", { cache:"no-store" });
        const bankJson = await bankRes.json();
        if (bankRes.ok && bankJson.success && bankJson.data?.or_account) orBank = bankJson.data.or_account;
    } catch (_) {}
    const workshopHeader = await getWorkshopPrintHeader();
    const workshopName = await getCurrentWorkshopName();
    const customerName = String(row.customer_name || "-").trim() || "-";
    const html = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>MyWorkshop</title>
<style>
@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:10px;margin:0}.sheet{width:100%;max-width:180mm;margin:0 auto}.header{border-bottom:0;padding-bottom:6px;display:flex;justify-content:space-between}.brand{font-size:16px;font-weight:700}.sub{font-size:8px;color:#666;margin-top:2px}.title{text-align:center;font-size:15px;font-weight:700;margin:11px 0 9px}.meta{width:100%;border-collapse:collapse;margin-bottom:10px}.meta td{padding:3px 2px;border-bottom:1px solid #ddd}.meta .label{font-weight:700;width:30%}.amount{border:1px solid #222;padding:10px;text-align:center;margin-top:12px}.amount-label{font-size:10px}.amount-value{font-size:20px;font-weight:700;margin-top:5px}.note{margin-top:12px;border:1px solid #999;padding:7px;min-height:32px}.transfer-template{margin-top:14px;padding:9px 10px;border:1px solid #999;font-size:9px;line-height:1.5}.sign{display:grid;grid-template-columns:1fr 1fr;text-align:center;margin-top:55px;font-size:9px}.sign-line{display:block;margin-top:32px}.footer{text-align:center;font-size:7px;color:#666;margin-top:10px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="sheet">
<div class="header">${workshopHeader}<div>TAGIHAN OWN RISK (OR)</div></div>
<div class="title">TAGIHAN OWN RISK (OR)</div>
<table class="meta"><tr><td class="label">No. WO</td><td>${escapeHTML(row.wo_number)}</td></tr><tr><td class="label">No. Estimasi</td><td>${escapeHTML(row.estimate_number)}</td></tr><tr><td class="label">Customer</td><td>${escapeHTML(row.customer_name)}</td></tr><tr><td class="label">No. Polisi</td><td>${escapeHTML(row.plate_number)}</td></tr><tr><td class="label">Asuransi</td><td>${escapeHTML(row.insurer_alias || row.insurerAlias || "-")}</td></tr><tr><td class="label">Tanggal</td><td>${escapeHTML(formatDateOnly(new Date()))}</td></tr></table>
<div class="amount"><div class="amount-label">NILAI OWN RISK (OR)</div><div class="amount-value">${escapeHTML(rupiah(row.own_risk))}</div></div>
${paymentDescription ? `<div class="note"><b>Keterangan</b><br>${escapeHTML(paymentDescription)}</div>` : ""}
<div class="transfer-template">Jika pembayaran dilakukan transfer, silakan ke Nomor Rekening <strong>${escapeHTML(orBank.bank || "BANK ABC")}</strong> No. <strong>${escapeHTML(orBank.account_number || "XXXXXX")}</strong> atas Nama <strong>${escapeHTML(orBank.account_name || "XXXXXXXXXXXXXXXXXXXXXXXX")}</strong>.</div>
<div class="sign"><div>${escapeHTML(customerName)}<span class="sign-line">________________________</span></div><div>${escapeHTML(workshopName)}<span class="sign-line">________________________</span></div></div>
<div class="footer">Dokumen Tagihan Own Risk (OR) - MyWorkshop</div></div><script>window.onload=function(){setTimeout(function(){window.print()},300)};<\/script></body></html>`;
    const w = window.open("", "_blank", "width=700,height=800");
    if (!w) return myWorkshopAlert("Popup diblokir browser. Izinkan popup untuk mencetak PDF.");
    w.document.write(html);
    w.document.close();
}


function openLetterWindow(title, html) {
    const w = window.open("", "_blank", "width=850,height=900");
    if (!w) {
        myWorkshopAlert("Popup diblokir browser. Izinkan popup untuk mencetak surat.");
        return;
    }
    w.document.write(html);
    w.document.close();
}

function getORRow(woId) {
    const row = orData.find(x => String(x.wo_id) === String(woId));
    if (!row) myWorkshopAlert("Data WO untuk surat tidak ditemukan.");
    return row;
}

async function printRatingLetter(woId) {
    const row = getORRow(woId);
    if (!row) return;

    const brandModel = [row.brand, row.model].filter(Boolean).join(" ") || "-";
    const stars = '<span class="stars">☆ ☆ ☆ ☆ ☆</span>';
    const workshopHeader = await getWorkshopPrintHeader();
    const workshopName = await getCurrentWorkshopName();
    const customerName = String(row.customer_name || "-").trim() || "-";
    const html = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>MyWorkshop</title>
<style>
@page{size:A4;margin:16mm 17mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:11px;margin:0}.sheet{width:100%;max-width:180mm;margin:0 auto}.header{text-align:center;border-bottom:0;padding-bottom:6px;margin-bottom:10px}.brand{font-size:17px;font-weight:700}.sub{font-size:9px;margin-top:3px}.title{text-align:center;font-size:16px;font-weight:700;margin:0 0 10px}.meta{width:100%;border-collapse:collapse;margin-bottom:10px}.meta td{padding:2px 3px;vertical-align:top}.meta .label{font-weight:700;width:38%}.intro{line-height:1.35;margin:5px 0 8px}.rating{width:100%;border-collapse:collapse;margin-top:2px}.rating td{border:0;padding:3px 2px;vertical-align:middle}.rating .criteria{width:67%;font-weight:600}.stars{font-size:23px;letter-spacing:2px;white-space:nowrap;font-family:"Times New Roman",serif}.comment-title{font-weight:700;margin-top:10px;margin-bottom:4px}.comment-lines{min-height:100px}.comment-lines div{height:20px;border-bottom:1px solid #777}.comment-lines div:last-child{border-bottom:1px solid #777}.closing{margin-top:12px;line-height:1.4}.sign{text-align:left;margin-top:30px}.sign .line{margin-top:45px;width:220px;border-bottom:1px solid #111}.footer{text-align:center;font-size:8px;color:#666;margin-top:20px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="sheet">
${workshopHeader}
<div class="title">PENILAIAN PELAYANAN BENGKEL</div>
<table class="meta"><tr><td class="label">No. WO</td><td>${escapeHTML(row.wo_number || "-")}</td></tr><tr><td class="label">Nama Customer</td><td>${escapeHTML(row.customer_name || "-")}</td></tr><tr><td class="label">No. Polisi</td><td>${escapeHTML(row.plate_number || "-")}</td></tr><tr><td class="label">Merek dan Type Mobil</td><td>${escapeHTML(brandModel)}</td></tr></table>
<div class="intro">Dengan ini memberikan rating kepada bengkel <b>${escapeHTML(workshopName)}</b> atas pelayanannya kepada saya:</div>
<table class="rating"><tbody>
<tr><td class="criteria">Proses Pendaftaran</td><td>${stars}</td></tr>
<tr><td class="criteria">Proses Perbaikan Kendaraan</td><td>${stars}</td></tr>
<tr><td class="criteria">Hasil Perbaikan Kendaraan</td><td>${stars}</td></tr>
<tr><td class="criteria">Informasi yang Diberikan</td><td>${stars}</td></tr>
<tr><td class="criteria">Lingkungan Bengkel Kami</td><td>${stars}</td></tr>
<tr><td class="criteria">Pelayanan Karyawan Kami</td><td>${stars}</td></tr>
</tbody></table>
<div class="comment-title">Komentar lain:</div><div class="comment-lines"><div></div><div></div><div></div><div></div><div></div></div>
<div class="closing">Demikian saya sampaikan untuk bisa lebih ditingkatkan lagi.<br>Terima kasih.</div>
<div class="sign">${escapeHTML(customerName)}<div class="line"></div></div>
<div class="footer">Form Penilaian Pelayanan Bengkel - MyWorkshop</div>
</div><script>window.onload=function(){setTimeout(function(){window.print()},300)};<\/script></body></html>`;
    openLetterWindow("Ajukan Rating", html);
}

function addMonthsSafe(date, months) {
    const d = new Date(date);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return d;
}

async function printWarrantyLetter(woId) {
    const row = getORRow(woId);
    if (!row) return;

    // Garansi dimulai dari saat pertama kali OR diprint, bukan saat Surat Garansi diprint.
    const warrantyStartDate = getFirstORPrintDate(woId) || new Date();
    const months = getWarrantyMonths(woId);
    const endDate = addMonthsSafe(warrantyStartDate, months);
    const brandModel = [row.brand, row.model].filter(Boolean).join(" ") || "-";
    const workshopHeader = await getWorkshopPrintHeader();
    const workshopName = await getCurrentWorkshopName();
    const html = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>MyWorkshop</title>
<style>
@page{size:A4;margin:18mm 18mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:11px;margin:0}.sheet{width:100%;max-width:178mm;margin:0 auto}.header{text-align:center;border-bottom:0;padding-bottom:9px;margin-bottom:20px}.brand{font-size:17px;font-weight:700}.sub{font-size:9px;margin-top:3px}.title{text-align:center;font-size:17px;font-weight:700;margin:0 0 20px}.meta{width:100%;border-collapse:collapse;margin-bottom:10px}.meta td{padding:2px 3px;vertical-align:top}.meta .label{font-weight:700;width:38%}.body-text{line-height:1.65;text-align:justify}.conditions{margin:14px 0 14px 20px;padding:0}.conditions li{margin-bottom:8px;line-height:1.5;padding-left:3px}.note{font-weight:700;margin-top:20px}.closing{margin-top:28px;line-height:1.6}.sign{margin-top:42px;text-align:left}.sign .line{margin-top:55px;width:250px;border-bottom:1px solid #111}.footer{text-align:center;font-size:8px;color:#666;margin-top:20px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="sheet">
${workshopHeader}
<div class="title">SURAT GARANSI</div>
<table class="meta"><tr><td class="label">No. WO</td><td>${escapeHTML(row.wo_number || "-")}</td></tr><tr><td class="label">Nama Customer</td><td>${escapeHTML(row.customer_name || "-")}</td></tr><tr><td class="label">No. Polisi</td><td>${escapeHTML(row.plate_number || "-")}</td></tr><tr><td class="label">Merek dan Type Mobil</td><td>${escapeHTML(brandModel)}</td></tr><tr><td class="label">Asuransi</td><td>${escapeHTML(row.insurer_alias || row.insurerAlias || "-")}</td></tr></table>
<div class="body-text">Kami bengkel <b>${escapeHTML(workshopName)}</b> berkomitmen untuk selalu memberikan pelayanan yang terbaik kepada setiap pelanggan kami, sehingga kami memberikan garansi perbaikan/pengecatan selama <b>${months} bulan</b> sejak surat ini dibuat tanggal <b>${escapeHTML(formatDateOnly(warrantyStartDate))}</b> sampai <b>${escapeHTML(formatDateOnly(endDate))}</b> untuk panel-panel yang sudah kami kerjakan/perbaiki di SPK ini, dengan kondisi:</div>
<ol class="conditions"><li>Hasil cat kurang maksimal</li><li>Warna cat pudar</li><li>Hasil perbaikan kurang maksimal seperti masih ada penyok atau baret</li><li>Ada kotoran dari proses perbaikan yang tidak semestinya.</li></ol>
<div class="note">**Mohon untuk dibawa pada saat klaim garansi</div>
<div class="closing">Hormat kami</div>
<div class="sign"><b>${escapeHTML(workshopName)}</b><div class="line"></div></div>
<div class="footer">Surat Garansi Perbaikan/Pengecatan - MyWorkshop</div>
</div><script>window.onload=function(){setTimeout(function(){window.print()},300)};<\/script></body></html>`;
    openLetterWindow("Surat Garansi", html);
}

async function openPaymentModal(woId) {
    try {
        const data = await apiRequest(`/api/tagihan-or/${encodeURIComponent(woId)}`);
        if (!data?.data) throw new Error("Data Tagihan Own Risk tidak ditemukan.");
        currentPaymentWO = data.data;
        el("payWONumber").textContent = currentPaymentWO.wo_number || "-";
        el("payCustomer").textContent = currentPaymentWO.customer_name || "-";
        el("payOwnRisk").textContent = rupiah(currentPaymentWO.own_risk);
        el("payFree").textContent = rupiah(currentPaymentWO.free_amount || 0);
        el("payDue").textContent = rupiah(currentPaymentWO.amount_due ?? Math.max(0, Number(currentPaymentWO.own_risk || 0) - Number(currentPaymentWO.free_amount || 0)));
        el("payTotalPaid").textContent = rupiah(currentPaymentWO.total_paid ?? currentPaymentWO.paid_amount ?? 0);
        el("payRemaining").textContent = rupiah(currentPaymentWO.remaining_amount || 0);
        el("paymentMethod").value = "";
        if (el("transferInstruction")) el("transferInstruction").style.display = "none";
        el("paymentFree").value = Number(currentPaymentWO.free_amount || 0);
        el("paymentAmount").value = Number(currentPaymentWO.remaining_amount ?? currentPaymentWO.amount_due ?? currentPaymentWO.own_risk ?? 0);
        el("paymentDescription").value = "";
        const paymentHistory = [...(data.payments || [])].sort((a, b) => {
            const da = new Date(a.paid_at || a.created_at || 0).getTime();
            const db = new Date(b.paid_at || b.created_at || 0).getTime();
            if (da !== db) return da - db;
            return Number(a.id || a.payment_id || 0) - Number(b.id || b.payment_id || 0);
        });
        el("paymentHistory").innerHTML = paymentHistory.length
            ? paymentHistory.map((p, idx) => `<tr><td>${idx + 1}</td><td>${escapeHTML(formatDate(p.paid_at || p.created_at))}</td><td>${escapeHTML(p.payment_method || "-")}</td><td>${escapeHTML(rupiah(p.amount))}</td><td>${escapeHTML(p.description || "-")}</td></tr>`).join("")
            : '<tr><td colspan="5" style="text-align:center;color:#6b7280">Belum ada pembayaran.</td></tr>';
        el("paymentModal").classList.add("show");
    } catch (e) {
        myWorkshopAlert("Gagal membuka pembayaran.\n\n" + e.message);
    }
}

function closePaymentModal() {
    currentPaymentWO = null;
    el("paymentModal")?.classList.remove("show");
}

function recalculateORPaymentAmount() {
    if (!currentPaymentWO) return;
    const ownRisk = Number(currentPaymentWO.own_risk || 0);
    const paid = Number(currentPaymentWO.paid_amount ?? currentPaymentWO.total_paid ?? 0);
    const free = Math.min(ownRisk, Math.max(0, Number(el("paymentFree")?.value || 0)));
    const due = Math.max(0, ownRisk - free);
    const remaining = Math.max(0, due - paid);
    if (el("payFree")) el("payFree").textContent = rupiah(free);
    if (el("payDue")) el("payDue").textContent = rupiah(due);
    if (el("payRemaining")) el("payRemaining").textContent = rupiah(remaining);
    if (el("paymentAmount")) el("paymentAmount").value = remaining;
}

async function submitPayment(event) {
    event.preventDefault();
    if (!currentPaymentWO) return;
    const amount = Number(el("paymentAmount").value || 0);
    const freeAmount = Number(el("paymentFree").value || 0);
    const method = el("paymentMethod").value;
    const description = el("paymentDescription").value.trim();
    if (!method) return myWorkshopAlert("Pilih metode pembayaran.");
    if (amount < 0) return myWorkshopAlert("Nilai Dibayar tidak boleh kurang dari 0.");
    const ownRisk = Number(currentPaymentWO.own_risk || 0);
    const paidBefore = Number(currentPaymentWO.paid_amount ?? currentPaymentWO.total_paid ?? 0);
    const effectiveFree = Math.min(ownRisk, Math.max(0, freeAmount));
    const amountDue = Math.max(0, ownRisk - effectiveFree);
    const remainingBeforePayment = Math.max(0, amountDue - paidBefore);
    if (amount === 0 && remainingBeforePayment > 0) return myWorkshopAlert("Nilai Dibayar harus lebih dari 0 karena masih ada sisa tagihan.");
    if (amount > remainingBeforePayment) return myWorkshopAlert("Nilai Dibayar melebihi sisa Tagihan Own Risk.");
    const user = (() => { try { return JSON.parse(localStorage.getItem("myworkshop_user") || "null"); } catch (_) { return null; } })();
    const createdBy = Number(user?.id || user?.user_id || 0) || null;
    try {
        const result = await apiRequest(`/api/tagihan-or/${encodeURIComponent(currentPaymentWO.wo_id)}/pembayaran`, {
            method: "POST",
            body: JSON.stringify({ payment_method: method, amount, free_amount: freeAmount, description, created_by: createdBy })
        });
        await myWorkshopAlert(result.message || "Pembayaran Tagihan Own Risk berhasil disimpan.", "success");
        closePaymentModal();
        await loadOR();
    } catch (e) {
        myWorkshopAlert("Pembayaran gagal.\n\n" + e.message);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    if (el("currentDate")) el("currentDate").textContent = new Date().toLocaleDateString("id-ID", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
    el("searchOR")?.addEventListener("input", renderList);
    el("paymentForm")?.addEventListener("submit", submitPayment);
    el("paymentFree")?.addEventListener("input", recalculateORPaymentAmount);
    el("paymentMethod")?.addEventListener("change", e => { if (el("transferInstruction")) el("transferInstruction").style.display = e.target.value === "TRANSFER" ? "block" : "none"; });
    el("paymentModal")?.addEventListener("click", e => { if (e.target === el("paymentModal")) closePaymentModal(); });
    loadOR();
});

window.printORTagihan = printORTagihan;
window.printRatingLetter = printRatingLetter;
window.printWarrantyLetter = printWarrantyLetter;
window.openPaymentModal = openPaymentModal;
window.closePaymentModal = closePaymentModal;


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
// ============================================================
// MYWORKSHOP - PERMINTAAN SPAREPART
// Sumber utama mengikuti WO yang sedang dipakai aplikasi.
// Hanya sparepart dengan status BENGKEL yang ditampilkan.
// Data pembelian/PO TIDAK mengubah Estimasi maupun WO.
// ============================================================

const PS_WO_KEY = myWorkshopScopedStorageKey("myworkshop_wo");
const PS_PO_KEY = myWorkshopScopedStorageKey("myworkshop_purchase_orders");

let psWOData = [];
let psPOData = [];
let psCurrentWO = null;
let psKuitansiData = [];

function psEl(id) { return document.getElementById(id); }

function psEscape(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function psAskReturnReason(partName) {
    return new Promise(resolve => {
        const existing = document.getElementById("psReturnReasonModal");
        if (existing) existing.remove();

        const modal = document.createElement("div");
        modal.id = "psReturnReasonModal";
        modal.innerHTML = `
            <div class="ps-return-modal-backdrop">
                <div class="ps-return-modal" role="dialog" aria-modal="true" aria-labelledby="psReturnReasonTitle">
                    <div class="ps-return-modal-header">
                        <h3 id="psReturnReasonTitle">Alasan RETURN Sparepart</h3>
                        <button type="button" class="ps-return-modal-close" aria-label="Tutup">&times;</button>
                    </div>
                    <div class="ps-return-modal-body">
                        <div class="ps-return-modal-part">${psEscape(partName || "Sparepart")}</div>
                        <label for="psReturnReasonInput">Alasan RETURN <span>*</span></label>
                        <textarea id="psReturnReasonInput" rows="4" placeholder="Masukkan alasan RETURN..."></textarea>
                    </div>
                    <div class="ps-return-modal-footer">
                        <button type="button" class="btn-secondary ps-return-cancel">Batal</button>
                        <button type="button" class="btn-primary ps-return-save">Simpan RETURN</button>
                    </div>
                </div>
            </div>`;

        const styleId = "psReturnReasonModalStyle";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
                #psReturnReasonModal{position:fixed;inset:0;z-index:10000;}
                .ps-return-modal-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:20px;}
                .ps-return-modal{width:min(520px,100%);background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden;}
                .ps-return-modal-header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #e5e7eb;}
                .ps-return-modal-header h3{margin:0;font-size:17px;}
                .ps-return-modal-close{border:0;background:transparent;font-size:25px;line-height:1;cursor:pointer;color:#64748b;}
                .ps-return-modal-body{padding:18px;}
                .ps-return-modal-part{font-weight:600;margin-bottom:14px;}
                .ps-return-modal-body label{display:block;font-weight:600;margin-bottom:7px;}
                .ps-return-modal-body label span{color:#dc2626;}
                .ps-return-modal-body textarea{width:100%;min-height:100px;resize:vertical;padding:10px;border:1px solid #cbd5e1;border-radius:7px;font:inherit;box-sizing:border-box;}
                .ps-return-modal-body textarea:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.12);}
                .ps-return-modal-footer{display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid #e5e7eb;}
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(modal);
        const input = modal.querySelector("#psReturnReasonInput");
        const close = value => { modal.remove(); resolve(value); };
        modal.querySelector(".ps-return-modal-close").addEventListener("click", () => close(null));
        modal.querySelector(".ps-return-cancel").addEventListener("click", () => close(null));
        modal.querySelector(".ps-return-modal-backdrop").addEventListener("click", e => {
            if (e.target === e.currentTarget) close(null);
        });
        modal.querySelector(".ps-return-save").addEventListener("click", () => {
            const value = String(input.value || "").trim();
            if (!value) {
                input.focus();
                return;
            }
            close(value);
        });
        input.addEventListener("keydown", e => {
            if (e.key === "Escape") close(null);
        });
        setTimeout(() => input.focus(), 0);
    });
}

function psLoadJSON(key, fallback = []) {
    try {
        const raw = localStorage.getItem(key);
        const value = raw ? JSON.parse(raw) : fallback;
        return Array.isArray(value) ? value : fallback;
    } catch (e) {
        console.error("Gagal membaca", key, e);
        return fallback;
    }
}

async function psSavePO() {
    // Simpan terlebih dahulu di browser agar data PO tidak hilang saat halaman di-refresh.
    // Penyimpanan pusat tetap digunakan sebagai penyimpanan utama bersama antar sesi/user.
    localStorage.setItem(PS_PO_KEY, JSON.stringify(psPOData));

    const u = (() => { try { return JSON.parse(localStorage.getItem("myworkshop_user") || "null") || {}; } catch (_) { return {}; } })();
    if (!window.myWorkshopCentralStorage) {
        console.warn("Penyimpanan pusat belum tersedia. PO tetap tersimpan di browser.");
        return;
    }
    await window.myWorkshopCentralStorage.set("purchase_orders", psPOData, u.id || u.user_id || null);
}

function psStatus(wo) {
    return String(wo?.status || "CHECK IN").trim().toUpperCase();
}

function psActiveWO(wo) {
    // Permintaan Sparepart adalah daftar pekerjaan pembelian dan penerimaan.
    // WO tetap tampil selama masih ada sparepart BENGKEL yang BELUM DATANG,
    // walaupun Tagihan Kuitansi sudah dibuat. Jika seluruh sparepart BENGKEL
    // sudah diterima, barulah WO boleh hilang setelah Tagihan Kuitansi dibuat.
    const woId = psWOId(wo);
    const parts = psBengkelParts(wo);
    if (!parts.length) return false;

    const po = psPO(woId);
    const items = Array.isArray(po?.items) ? po.items : [];
    const remaining = parts.reduce((count, part, index) => {
        const item = psFindPOItem(po, part, index);
        return count + (item?.arrival_date || item?.arrived ? 0 : 1);
    }, 0);

    const apiBill = psKuitansiData.find(b => String(b?.wo_id ?? b?.woId ?? b?.id ?? "") === String(woId));
    const hasKuitansi = !!(apiBill?.kuitansi_id || apiBill?.id);

    return remaining > 0 || !hasKuitansi;
}

function psSupply(item) {
    return String(item?.supply_bengkel ?? item?.supplyBengkel ?? item?.supply ?? "BENGKEL").trim().toUpperCase();
}

function psSpareparts(wo) {
    const arr = wo?.spareparts || wo?.sparepart || wo?.items_sparepart || [];
    return Array.isArray(arr) ? arr : [];
}

function psBengkelParts(wo) {
    return psSpareparts(wo).filter(item => psSupply(item) === "BENGKEL");
}

function psWOId(wo) {
    return String(wo?.id ?? wo?.wo_id ?? wo?.wo_number ?? "");
}

function psWONumber(wo) {
    return String(wo?.wo_number ?? wo?.woNumber ?? wo?.number ?? "-");
}

function psEstimate(wo) {
    return String(wo?.estimate_number ?? wo?.estimateNumber ?? wo?.noEstimasi ?? "-");
}

function psInsurer(wo) {
    // Tampilkan NAMA ALIAS Asuransi saja. Jangan pernah menampilkan insurer_id.
    const alias = wo?.insurer_alias ?? wo?.insurerAlias ?? wo?.asuransi_alias ?? wo?.insurance_alias ?? wo?.alias_asuransi;
    return String(alias ?? "-").trim() || "-";
}

function psCustomer(wo) {
    return String(wo?.customer_name ?? wo?.customerName ?? wo?.customer ?? "-");
}

function psPlate(wo) {
    return String(wo?.plate_number ?? wo?.plateNumber ?? wo?.plate ?? "-");
}

function psBrand(wo) {
    return String(wo?.brand ?? wo?.vehicle_brand ?? wo?.vehicleBrand ?? wo?.merk ?? wo?.make ?? "-");
}

function psModel(wo) {
    return String(wo?.model ?? wo?.vehicle_model ?? wo?.vehicleModel ?? wo?.type ?? wo?.vehicle_type ?? "-");
}

function psYear(wo) {
    return String(wo?.year ?? wo?.vehicle_year ?? wo?.vehicleYear ?? wo?.tahun ?? wo?.tahun_mobil ?? "-");
}

function psVIN(wo) {
    return String(wo?.vin_number ?? wo?.vinNumber ?? wo?.vin ?? wo?.noRangka ?? wo?.no_rangka ?? wo?.chassis_number ?? wo?.chassisNumber ?? wo?.frame_number ?? wo?.frameNumber ?? "-");
}

function psEstimateSparepartPrice(item) {
    const raw = item?.unit_price ?? item?.price;
    if (raw === null || raw === undefined || String(raw).trim() === "") return "";
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0
        ? Math.round((value + Number.EPSILON) * 100) / 100
        : "";
}

function psEstimateSparepartDiscountPercent(item) {
    const storedPercent = item?.discountPercent ?? item?.discount_percent;
    if (storedPercent !== null && storedPercent !== undefined && String(storedPercent).trim() !== "") {
        const value = Number(storedPercent);
        return Number.isFinite(value)
            ? Math.round((Math.min(100, Math.max(0, value)) + Number.EPSILON) * 100) / 100
            : "";
    }

    // Database lama dapat menyimpan discount sebagai nominal, sedangkan
    // PO membutuhkan Diskon Asuransi (%) sesuai yang tampil di Estimasi.
    const qty = Number(item?.quantity ?? item?.qty ?? 1);
    const price = Number(item?.unit_price ?? item?.price ?? 0);
    const discount = Number(item?.discount ?? item?.discount_amount ?? 0);
    const bruto = qty * price;
    if (!Number.isFinite(bruto) || bruto <= 0) return discount === 0 ? 0 : "";
    if (!Number.isFinite(discount) || discount < 0) return "";
    return Math.round((Math.min(100, Math.max(0, (discount / bruto) * 100)) + Number.EPSILON) * 100) / 100;
}


function psNormalizePartIdentity(value) {
    return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function psPartIdentity(part) {
    return {
        id: Number(part?.id ?? part?.estimate_sparepart_id),
        sku: psNormalizePartIdentity(part?.part_number ?? part?.partNumber ?? part?.sku),
        name: psNormalizePartIdentity(part?.part_name ?? part?.partName ?? part?.name)
    };
}

// Cari item PO berdasarkan identitas sparepart, bukan posisi/index.
// Ini mencegah sparepart A tertukar dengan sparepart B ketika ada
// item SUPPLY/BENGKEL atau urutan sparepart yang berubah.
function psFindPOItem(po, part, index = -1) {
    const items = Array.isArray(po?.items) ? po.items : [];
    const identity = psPartIdentity(part);

    if (Number.isInteger(identity.id) && identity.id > 0) {
        const byId = items.find(item => {
            const itemId = Number(item?.estimate_sparepart_id ?? item?.item_id ?? item?.itemId);
            return Number.isInteger(itemId) && itemId > 0 && itemId === identity.id;
        });
        if (byId) return byId;
    }

    if (identity.sku || identity.name) {
        const exact = items.filter(item => {
            const itemSku = psNormalizePartIdentity(item?.sku ?? item?.part_number ?? item?.partNumber);
            const itemName = psNormalizePartIdentity(item?.name ?? item?.part_name ?? item?.partName);
            return identity.sku && identity.name
                ? itemSku === identity.sku && itemName === identity.name
                : (identity.sku ? itemSku === identity.sku : itemName === identity.name);
        });
        if (exact.length === 1) return exact[0];
    }

    // Hanya gunakan index untuk PO lama yang benar-benar tidak memiliki
    // identitas sparepart sama sekali. PO baru selalu menyimpan ID.
    const hasIdentityData = items.some(item =>
        Number(item?.estimate_sparepart_id ?? item?.item_id ?? item?.itemId) > 0 ||
        psNormalizePartIdentity(item?.sku ?? item?.part_number ?? item?.partNumber) ||
        psNormalizePartIdentity(item?.name ?? item?.part_name ?? item?.partName)
    );
    return !hasIdentityData && index >= 0 ? (items[index] || null) : null;
}

function psPO(woId) {
    return psPOData.find(x => String(x.wo_id) === String(woId)) || null;
}

function psGeneratePONumber() {
    const year = new Date().getFullYear();
    let max = 0;
    psPOData.forEach(po => {
        const match = String(po.po_number || "").match(/(\d+)$/);
        if (match) max = Math.max(max, Number(match[1]));
    });
    return `PO-${year}-${String(max + 1).padStart(4, "0")}`;
}

function psToday() {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function psDate(value) {
    if (!value) return "-";
    const d = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("id-ID", {day:"2-digit",month:"2-digit",year:"numeric"});
}

function psMoney(value) {
    const n = Number(value || 0);
    return n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

function psIsReturned(item) {
    return !!(item?.returned || item?.return_status === "RETURN" || item?.status === "RETURN");
}

function psReturnReason(item) {
    const history = Array.isArray(item?.return_history) ? item.return_history : [];
    const latest = history.length ? history[history.length - 1] : null;
    return String(item?.return_reason ?? latest?.reason ?? "").trim();
}

function psReturnHistory(item) {
    return Array.isArray(item?.return_history) ? item.return_history : [];
}


async function psLoad() {
    // Semua data daftar dibaca dari satu snapshot database pusat yang sama
    // untuk Manager Master maupun Sparepart/Gudang.
    psWOData = [];
    psPOData = [];
    psKuitansiData = [];
    try {
        const response = await fetch("/api/sparepart/work-data", {
            headers: { "Content-Type": "application/json" },
            cache: "no-store"
        });
        const result = await response.json().catch(() => ({}));
        if (response.status === 401) {
            localStorage.removeItem("myworkshop_user");
            window.location.href = "/";
            return;
        }
        if (!response.ok || result?.success === false) throw new Error(result?.message || `HTTP ${response.status}`);
        psWOData = Array.isArray(result.data) ? result.data : [];
        psKuitansiData = Array.isArray(result.kuitansi) ? result.kuitansi : [];
        psPOData = Array.isArray(result.purchase_orders) ? result.purchase_orders : [];

        // Pertahankan localStorage hanya sebagai cache lama; daftar yang tampil
        // tidak lagi bergantung pada data browser sehingga semua role konsisten.
        if (psPOData.length) localStorage.setItem(PS_PO_KEY, JSON.stringify(psPOData));
    } catch (e) {
        console.error("Gagal mengambil snapshot Sparepart dari database pusat:", e);
        psWOData = [];
        psPOData = [];
        psKuitansiData = [];
    }

    renderPSList();
}

function renderPSList() {
    const body = psEl("psWOBody");
    if (!body) return;

    const keyword = String(psEl("searchPermintaanSparepart")?.value || "").trim().toLowerCase();
    const poFilter = String(psEl("filterPOPermintaanSparepart")?.value || "SEMUA").trim().toUpperCase();
    const rows = psWOData
        .filter(psActiveWO)
        .filter(wo => psBengkelParts(wo).length)
        .filter(wo => {
            const hasPO = !!psPO(psWOId(wo));
            const summary = psArrivalSummary(psWOId(wo), psBengkelParts(wo));
            if (poFilter === "SUDAH_PO") return hasPO;
            if (poFilter === "BELUM_PO") return !hasPO;
            if (poFilter === "SUDAH_PO_BELUM_KOMPLIT") return hasPO && summary.remaining > 0;
            if (poFilter === "KOMPLIT") return hasPO && summary.remaining === 0;
            return true;
        })
        .filter(wo => {
            const text = [
                psWONumber(wo),
                psEstimate(wo),
                psCustomer(wo),
                psPlate(wo)
            ].join(" ").toLowerCase();
            return !keyword || text.includes(keyword);
        });

    if (!rows.length) {
        body.innerHTML = `<tr><td colspan="9" class="ps-empty">Belum ada WO aktif dengan sparepart BENGKEL.</td></tr>`;
        return;
    }

    body.innerHTML = rows.map((wo, index) => {
        const po = psPO(wo.id);
        const poButtons = po
            ? `<button class="btn-secondary btn-small" onclick="printPO('${psEscape(psWOId(wo))}')">Print PO</button>
               <button class="btn-secondary btn-small" onclick="openArrival('${psEscape(psWOId(wo))}')">Input Kedatangan</button>`
            : "";
        const psSummary = psArrivalSummary(psWOId(wo), psBengkelParts(wo));
        const arrival = !po
            ? `<span class="ps-badge">BELUM PO</span>`
            : psSummary.remaining === 0
                ? `<span class="ps-badge done">KOMPLIT</span>`
                : `<span class="ps-badge">BELUM KOMPLIT — ${psSummary.remaining} dari ${psSummary.total} BELUM DATANG</span>`;

        return `<tr>
            <td>${index + 1}</td>
            <td><strong>${psEscape(psWONumber(wo))}</strong></td>
            <td>${psEscape(psEstimate(wo))}</td>
            <td>${psEscape(psCustomer(wo))}</td>
            <td>${psEscape(psPlate(wo))}</td>
            <td>${psEscape(psInsurer(wo))}</td>
            <td>${psBengkelParts(wo).length}</td>
            <td>${arrival}</td>
            <td><div class="ps-actions">
                <button class="btn-primary btn-small" onclick="openPSDetail('${psEscape(psWOId(wo))}')">Detail</button>
                ${poButtons}
            </div></td>
        </tr>`;
    }).join("");
}

function openPSDetail(id) {
    psCurrentWO = psWOData.find(w => psWOId(w) === String(id));
    if (!psCurrentWO) {
        myWorkshopAlert("WO tidak ditemukan.");
        return;
    }

    const parts = psBengkelParts(psCurrentWO);
    psEl("psDetailTitle").textContent = `Detail Permintaan Sparepart - ${psWONumber(psCurrentWO)}`;
    psEl("psDetailInfo").innerHTML = `<div class="ps-info">
        <div class="ps-info-item"><div class="ps-info-label">No. WO</div><div class="ps-info-value">${psEscape(psWONumber(psCurrentWO))}</div></div>
        <div class="ps-info-item"><div class="ps-info-label">No. Estimasi</div><div class="ps-info-value">${psEscape(psEstimate(psCurrentWO))}</div></div>
        <div class="ps-info-item"><div class="ps-info-label">Customer</div><div class="ps-info-value">${psEscape(psCustomer(psCurrentWO))}</div></div>
        <div class="ps-info-item"><div class="ps-info-label">No. Polisi</div><div class="ps-info-value">${psEscape(psPlate(psCurrentWO))}</div></div>
        <div class="ps-info-item"><div class="ps-info-label">Merek Mobil</div><div class="ps-info-value">${psEscape(psCurrentWO.brand ?? psCurrentWO.vehicle_brand ?? psCurrentWO.merk ?? psCurrentWO.make ?? "-")}</div></div>
        <div class="ps-info-item"><div class="ps-info-label">Type Mobil</div><div class="ps-info-value">${psEscape(psCurrentWO.model ?? psCurrentWO.vehicle_model ?? psCurrentWO.type ?? psCurrentWO.vehicle_type ?? "-")}</div></div>
        <div class="ps-info-item"><div class="ps-info-label">No. Rangka</div><div class="ps-info-value">${psEscape(psVIN(psCurrentWO))}</div></div>
    </div>`;

    const po = psPO(psWOId(psCurrentWO));
    psEl("psDetailBody").innerHTML = parts.map((item, index) => {
        const existing = psFindPOItem(po, item, index) || {};
        const name = item.part_name ?? item.partName ?? item.name ?? "";
        // SKU / No. Part pada PO selalu mengikuti Estimasi terbaru.
        const sku = item.part_number ?? item.partNumber ?? item.sku ?? existing.sku ?? "";
        const qty = item.quantity ?? item.qty ?? 1;
        const returned = psIsReturned(existing);
        const returnReason = psReturnReason(existing);
        const arrival = !!(existing.arrival_date || existing.arrived) && !returned;
        const estimatePrice = psEstimateSparepartPrice(item);
        const estimateDiscountPercent = psEstimateSparepartDiscountPercent(item);
        const initialNetSell = estimatePrice === ""
            ? ""
            : Math.round((estimatePrice - (estimatePrice * Number(estimateDiscountPercent || 0) / 100) + Number.EPSILON) * 100) / 100;
        const status = returned
            ? `<span class="ps-return-badge">RETURN</span><small class="ps-return-reason">${psEscape(returnReason || "Alasan belum tercatat")}</small>`
            : arrival
                ? `<span class="ps-badge done">SUDAH DATANG</span>`
                : `<span class="ps-badge">BELUM DATANG</span>`;
        const action = returned
            ? `<button type="button" class="btn-primary btn-small replacement-arrival-btn" onclick="openArrival('${psEscape(psWOId(psCurrentWO))}')">Penerimaan Pengganti</button>`
            : arrival
                ? `<button type="button" class="btn-secondary btn-small" onclick="openPSReturn(${index})">RETURN</button>`
                : "";
        return `<tr>
            <td>${index + 1}</td>
            <td>${psEscape(name)}</td>
            <td><input data-ps-field="sku" data-index="${index}" value="${psEscape(sku)}" placeholder="SKU / No. Part"></td>
            <td>${psEscape(qty)}</td>
            <td><input data-ps-field="price_list" data-index="${index}" type="number" min="0" step="0.01" value="${existing.price_list ?? existing.price_list_price ?? ""}" placeholder="Harga Price List" oninput="calculatePSNetto(${index})"></td>
            <td><input data-ps-field="discount" data-index="${index}" type="number" min="0" max="100" step="0.01" value="${existing.discount ?? ""}" placeholder="Diskon %" oninput="calculatePSNetto(${index})"></td>
            <td><input data-ps-field="net_buy" data-index="${index}" type="number" min="0" step="0.01" value="${existing.net_buy_price ?? existing.buy_price ?? ""}" placeholder="Netto Harga Beli" readonly></td>
            <td><input data-ps-field="sell" data-index="${index}" type="number" min="0" step="0.01" value="${estimatePrice}" placeholder="Harga Jual" oninput="calculatePSMargin(${index})"></td>
            <td><input data-ps-field="insurance_discount" data-index="${index}" type="number" min="0" max="100" step="0.01" value="${estimateDiscountPercent}" placeholder="Diskon %" oninput="calculatePSMargin(${index})"></td>
            <td><input data-ps-field="net_sell" data-index="${index}" type="number" min="0" step="0.01" value="${initialNetSell}" placeholder="Netto Harga Jual" readonly></td>
            <td><input data-ps-field="margin" data-index="${index}" type="number" min="0" step="0.01" value="${existing.margin ?? ""}" placeholder="Margin" readonly></td>
            <td>
                <select data-ps-field="vendorType" data-index="${index}" onchange="togglePSVendorOther(${index})">
                    <option value="STOK GUDANG" ${String(existing.vendor_type || existing.vendor || "").toUpperCase() === "STOK GUDANG" ? "selected" : ""}>Stok Gudang</option>
                    <option value="LAINNYA" ${String(existing.vendor_type || "").toUpperCase() === "LAINNYA" || (existing.vendor && String(existing.vendor).toUpperCase() !== "STOK GUDANG" && existing.vendor_type !== "STOK GUDANG") ? "selected" : ""}>Lainnya</option>
                </select>
                <input class="ps-vendor-other" data-ps-field="vendorOther" data-index="${index}" value="${String(existing.vendor_type || "").toUpperCase() === "LAINNYA" ? psEscape(existing.vendor ?? "") : ""}" placeholder="Nama Vendor" style="${String(existing.vendor_type || "").toUpperCase() === "LAINNYA" ? "" : "display:none"}">
            </td>
            <td>${status}<div class="ps-return-action">${action}</div></td>
        </tr>`;
    }).join("");

    parts.forEach((item, index) => {
        calculatePSNetto(index);
        const estimatePrice = psEstimateSparepartPrice(item);
        const estimateDiscountPercent = psEstimateSparepartDiscountPercent(item);
        const netInput = psEl("psDetailBody")?.querySelector(`input[data-ps-field="net_sell"][data-index="${index}"]`);
        if (netInput && estimatePrice !== "") {
            netInput.value = Math.round((estimatePrice - (estimatePrice * Number(estimateDiscountPercent || 0) / 100) + Number.EPSILON) * 100) / 100;
        }
        calculatePSMargin(index, true);
    });
    psEl("psDetailModal").classList.add("show");
}

function closePSDetail() {
    psEl("psDetailModal")?.classList.remove("show");
    psCurrentWO = null;
}

function calculatePSNetto(index) {
    const body = psEl("psDetailBody");
    if (!body) return;
    const priceInput = body.querySelector(`input[data-ps-field="price_list"][data-index="${index}"]`);
    const discountInput = body.querySelector(`input[data-ps-field="discount"][data-index="${index}"]`);
    const netInput = body.querySelector(`input[data-ps-field="net_buy"][data-index="${index}"]`);
    if (!priceInput || !discountInput || !netInput) return;

    const price = Number(priceInput.value);
    const discount = Number(discountInput.value);
    if (!Number.isFinite(price) || price < 0) {
        netInput.value = "";
        return;
    }
    const safeDiscount = Number.isFinite(discount) ? Math.min(100, Math.max(0, discount)) : 0;
    const netto = price - (price * safeDiscount / 100);
    netInput.value = Math.round((netto + Number.EPSILON) * 100) / 100;
}

function calculatePSMargin(index, preserveNetSell = false) {
    const body = psEl("psDetailBody");
    if (!body) return;
    const netInput = body.querySelector(`input[data-ps-field="net_buy"][data-index="${index}"]`);
    const sellInput = body.querySelector(`input[data-ps-field="sell"][data-index="${index}"]`);
    const discInput = body.querySelector(`input[data-ps-field="insurance_discount"][data-index="${index}"]`);
    const netSellInput = body.querySelector(`input[data-ps-field="net_sell"][data-index="${index}"]`);
    const marginInput = body.querySelector(`input[data-ps-field="margin"][data-index="${index}"]`);
    if (!netInput || !sellInput || !discInput || !netSellInput || !marginInput) return;
    const net = Number(netInput.value);
    if (!preserveNetSell) {
        const sellRaw = String(sellInput.value ?? "").trim();
        const disc = Math.max(0, Math.min(100, Number(discInput.value || 0)));
        if (sellRaw === "") {
            netSellInput.value = "";
        } else {
            const sell = Number(sellRaw);
            netSellInput.value = Number.isFinite(sell) && sell >= 0
                ? Math.round((sell - (sell * disc / 100) + Number.EPSILON) * 100) / 100
                : "";
        }
    }
    const netSellRaw = String(netSellInput.value ?? "").trim();
    const netSell = Number(netSellRaw);
    if (!Number.isFinite(net) || netSellRaw === "" || !Number.isFinite(netSell)) {
        marginInput.value = "";
        return;
    }
    marginInput.value = Math.round((netSell - net + Number.EPSILON) * 100) / 100;
}

function togglePSVendorOther(index) {
    const select = psEl("psDetailBody")?.querySelector(`select[data-ps-field="vendorType"][data-index="${index}"]`);
    const input = psEl("psDetailBody")?.querySelector(`input[data-ps-field="vendorOther"][data-index="${index}"]`);
    if (!select || !input) return;
    const other = select.value === "LAINNYA";
    input.style.display = other ? "block" : "none";
    if (!other) input.value = "";
}

async function psSyncEstimateSparepartPrices(wo, parts, getField) {
    const estimateId = Number(
        wo?.estimate_id ??
        wo?.estimateId ??
        wo?.estimasi_id ??
        wo?.estimasiId
    );
    if (!Number.isInteger(estimateId) || estimateId <= 0) return;

    const response = await fetch(`/api/estimasi/${encodeURIComponent(estimateId)}`, {
        cache: "no-store",
        headers: { "Accept": "application/json" }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.success === false || !result?.data) {
        throw new Error(result?.message || `Gagal mengambil Estimasi (${response.status})`);
    }

    const estimate = result.data;
    const sourceRows = Array.isArray(estimate.spareparts) ? estimate.spareparts : [];
    const updatedRows = sourceRows.map(row => ({ ...row }));

    // Sinkronisasi PO -> Estimasi hanya jika baris Estimasi dapat diidentifikasi
    // secara pasti. Tidak lagi menggunakan index sebagai fallback untuk data
    // yang mempunyai identitas, sehingga sparepart A tidak mungkin pindah ke B.
    parts.forEach((part, partIndex) => {
        const identity = psPartIdentity(part);
        let estimateIndex = -1;

        if (Number.isInteger(identity.id) && identity.id > 0) {
            estimateIndex = sourceRows.findIndex(row => Number(row?.id) === identity.id);
        }

        if (estimateIndex < 0 && (identity.sku || identity.name)) {
            const candidates = sourceRows
                .map((row, idx) => ({ row, idx }))
                .filter(({ row }) => {
                    const rowSku = psNormalizePartIdentity(row?.part_number ?? row?.partNumber ?? row?.sku);
                    const rowName = psNormalizePartIdentity(row?.part_name ?? row?.partName ?? row?.name);
                    return identity.sku && identity.name
                        ? rowSku === identity.sku && rowName === identity.name
                        : (identity.sku ? rowSku === identity.sku : rowName === identity.name);
                });
            if (candidates.length === 1) estimateIndex = candidates[0].idx;
        }

        if (estimateIndex < 0) return;

        const target = updatedRows[estimateIndex];
        const sellRaw = String(getField("sell", partIndex) ?? "").trim();
        const discountRaw = String(getField("insurance_discount", partIndex) ?? "").trim();
        const skuRaw = String(getField("sku", partIndex) ?? "").trim();
        const qty = Math.max(1, Number(target?.quantity ?? target?.qty ?? part?.quantity ?? part?.qty ?? 1) || 1);

        // SKU / No. Part berlaku 2 arah.
        if (skuRaw !== "") {
            target.part_number = skuRaw;
            target.sku = skuRaw;
        }

        // Harga Jual + Diskon Asuransi (%) berlaku 2 arah.
        if (sellRaw === "") return;
        const sell = Number(sellRaw);
        if (!Number.isFinite(sell) || sell < 0) return;

        const discountPercent = discountRaw === ""
            ? 0
            : Math.max(0, Math.min(100, Number(discountRaw) || 0));
        const discount = Math.round((qty * sell * discountPercent / 100 + Number.EPSILON) * 100) / 100;
        const total = Math.max(0, Math.round((qty * sell - discount + Number.EPSILON) * 100) / 100);

        target.unit_price = sell;
        target.price = sell;
        target.discount = discount;
        target.discountPercent = discountPercent;
        target.discount_percent = discountPercent;
        target.total_price = total;
        target.total = total;
    });

    const payload = {
        ...estimate,
        customer_id: estimate.customer_id ?? estimate.customerId,
        plate_number: estimate.plate_number ?? estimate.plateNumber,
        brand: estimate.brand ?? "",
        model: estimate.model ?? "",
        year: estimate.year ?? "",
        color: estimate.color ?? "",
        vin_number: estimate.vin_number ?? estimate.vinNumber ?? estimate.vin ?? "",
        engine_number: estimate.engine_number ?? estimate.engineNumber ?? "",
        insurer_id: estimate.insurer_id ?? estimate.insurerId ?? null,
        customer_note: estimate.customer_note ?? estimate.customerNote ?? estimate.notes ?? "",
        status: estimate.status,
        spareparts: updatedRows,
        jasa: Array.isArray(estimate.jasa) ? estimate.jasa : [],
        jasa_lain: Array.isArray(estimate.jasa_lain) ? estimate.jasa_lain : (Array.isArray(estimate.jasaLain) ? estimate.jasaLain : []),
        diskon: estimate.discount ?? 0,
        discount_sparepart_type: estimate.discount_sparepart_type ?? estimate.discountSparepartType ?? "PERCENT",
        discount_sparepart_value: estimate.discount_sparepart_value ?? estimate.discountSparepartValue ?? 0,
        discount_jasa_type: estimate.discount_jasa_type ?? estimate.discountJasaType ?? "PERCENT",
        discount_jasa_value: estimate.discount_jasa_value ?? estimate.discountJasaValue ?? 0,
        ppn_persen: estimate.ppn_percent ?? estimate.ppnPercent ?? 0,
        ppn_type: estimate.ppn_type ?? estimate.ppnType ?? "COMPLETE",
        material_percent: estimate.material_percent ?? estimate.materialPercent ?? 0,
        own_risk: estimate.own_risk ?? estimate.ownRisk ?? 0
    };

    const saveResponse = await fetch(`/api/estimasi/${encodeURIComponent(estimateId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
    });
    const saveResult = await saveResponse.json().catch(() => ({}));
    if (!saveResponse.ok || saveResult?.success === false) {
        throw new Error(saveResult?.message || `Gagal menyimpan perubahan Harga Jual/Diskon/SKU Estimasi (${saveResponse.status})`);
    }
}

async function createPurchaseOrder() {
    if (!psCurrentWO) {
        myWorkshopAlert("WO belum dipilih.");
        return;
    }

    try {
        const parts = psBengkelParts(psCurrentWO);
        if (!parts.length) {
            myWorkshopAlert("Tidak ada sparepart BENGKEL pada WO ini.");
            return;
        }

        const body = psEl("psDetailBody");
        if (!body) throw new Error("Form detail sparepart tidak ditemukan.");
        const fields = [...body.querySelectorAll("input[data-ps-field], select[data-ps-field]")];
        const get = (field, index) => {
            const el = fields.find(x => x.dataset.psField === field && Number(x.dataset.index) === index);
            return String(el?.value ?? "").trim();
        };
        const numberValue = (value, fallback = 0) => {
            const n = Number(String(value ?? "").replace(",", "."));
            return Number.isFinite(n) && n >= 0 ? n : fallback;
        };

        const items = parts.map((part, index) => {
            const priceList = numberValue(get("price_list", index), 0);
            const discount = Math.min(100, numberValue(get("discount", index), 0));
            const netBuy = Math.round((priceList - (priceList * discount / 100)) * 100) / 100;
            const estimatePrice = psEstimateSparepartPrice(part);
            const estimateDiscountPercent = psEstimateSparepartDiscountPercent(part);
            const sell = estimatePrice === "" ? "" : estimatePrice;
            const insuranceDiscount = estimateDiscountPercent === "" ? "" : estimateDiscountPercent;
            const netSellRaw = get("net_sell", index);
            const netSell = netSellRaw === "" ? "" : numberValue(netSellRaw, 0);
            const margin = netSell === "" ? "" : Math.round((netSell - netBuy) * 100) / 100;
            const vendorType = (get("vendorType", index) || "STOK GUDANG").toUpperCase();
            const vendorOther = get("vendorOther", index);
            const vendor = vendorType === "LAINNYA" ? (vendorOther || "Lainnya") : "Stok Gudang";

            const currentPO = psPO(psWOId(psCurrentWO));
            const previous = psFindPOItem(currentPO, part, index) || {};
            return {
                name: part.part_name ?? part.partName ?? part.name ?? "",
                estimate_sparepart_id: Number(part?.id) || null,
                estimate_sparepart_sequence: Number(part?.sequence) || index + 1,
                sku: get("sku", index),
                quantity: Math.max(1, numberValue(part.quantity ?? part.qty, 1)),
                unit: part.unit ?? "PCS",
                price_list: priceList,
                discount,
                net_buy_price: netBuy,
                buy_price: netBuy,
                sell_price: sell,
                insurance_discount: insuranceDiscount,
                net_sell_price: netSell,
                margin,
                vendor,
                vendor_type: vendorType,
                returned: !!previous.returned,
                return_reason: previous.return_reason || "",
                return_history: Array.isArray(previous.return_history) ? previous.return_history : [],
                ...(previous.arrival_date ? { arrival_date: previous.arrival_date, arrival_note: previous.arrival_note || "", arrived: true, arrival_at: previous.arrival_at || null } : {})
            };
        });

        // Harga Jual dan Diskon Asuransi (%) pada PO menjadi dua arah dengan Estimasi.
        // Perubahan di PO disimpan kembali ke Estimasi sebelum PO dipersist.
        await psSyncEstimateSparepartPrices(
            psCurrentWO,
            parts,
            (field, index) => get(field, index)
        );

        const old = psPO(psWOId(psCurrentWO));
        const po = old || {
            id: `LOCAL-PO-${Date.now()}`,
            po_number: psGeneratePONumber(),
            wo_id: psWOId(psCurrentWO),
            created_at: new Date().toISOString()
        };

        po.items = items;
        po.wo_number = psWONumber(psCurrentWO);
        po.estimate_number = psEstimate(psCurrentWO);
        po.customer_name = psCustomer(psCurrentWO);
        po.insurer_name = psInsurer(psCurrentWO);
        po.plate_number = psPlate(psCurrentWO);
        po.brand = psBrand(psCurrentWO);
        po.model = psModel(psCurrentWO);
        po.year = psYear(psCurrentWO);
        po.vin_number = psVIN(psCurrentWO);
        po.updated_at = new Date().toISOString();

        if (!old) psPOData.unshift(po);
        await psSavePO();

        closePSDetail();
        renderPSList();
        if (window.MyWorkshopReceiptPhotos?.success) MyWorkshopReceiptPhotos.success(`Purchase Order ${po.po_number} berhasil dibuat dan disimpan. PO sekarang dapat diprint.`);
        else myWorkshopAlert(`Purchase Order ${po.po_number} berhasil dibuat dan disimpan. PO sekarang dapat diprint.`, "success");
    } catch (e) {
        console.error("Gagal membuat Purchase Order:", e);
        myWorkshopAlert(`Gagal membuat Purchase Order: ${e?.message || e}`);
    }
}


async function psRefreshPOFromEstimate(wo, po) {
    const estimateId = Number(wo?.estimate_id ?? wo?.estimateId ?? wo?.estimasi_id ?? wo?.estimasiId);
    if (!Number.isInteger(estimateId) || estimateId <= 0 || !po) return;

    const response = await fetch(`/api/estimasi/${encodeURIComponent(estimateId)}`, {
        cache: "no-store",
        headers: { "Accept": "application/json" }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.success === false || !result?.data) {
        throw new Error(result?.message || `Gagal mengambil Estimasi terbaru (${response.status})`);
    }

    const estimateRows = Array.isArray(result.data.spareparts) ? result.data.spareparts : [];
    const parts = psBengkelParts(wo);
    const oldItems = Array.isArray(po.items) ? po.items : [];

    const nextItems = parts.map((part, index) => {
        const item = psFindPOItem({ items: oldItems }, part, index) || {};
        const rowIndex = Number(part?.id) > 0
            ? estimateRows.findIndex(row => Number(row?.id) === Number(part.id))
            : -1;
        const row = rowIndex >= 0 ? estimateRows[rowIndex] : null;

        if (!row) return {
            ...item,
            name: part.part_name ?? part.partName ?? part.name ?? item.name ?? "",
            estimate_sparepart_id: Number(part?.id) || item.estimate_sparepart_id || null,
            estimate_sparepart_sequence: Number(part?.sequence) || index + 1,
            sku: part.part_number ?? part.partNumber ?? part.sku ?? item.sku ?? ""
        };

        const sell = Number(row.unit_price ?? row.price);
        const discountPercent = psEstimateSparepartDiscountPercent(row);
        const netSell = Number.isFinite(sell) && sell >= 0
            ? Math.round((sell - sell * Number(discountPercent || 0) / 100 + Number.EPSILON) * 100) / 100
            : "";
        const netBuy = Number(item.net_buy_price ?? item.buy_price ?? 0);
        const margin = netSell === "" || !Number.isFinite(netBuy)
            ? ""
            : Math.round((netSell - netBuy + Number.EPSILON) * 100) / 100;

        return {
            ...item,
            name: row.part_name ?? row.partName ?? row.name ?? part.part_name ?? part.partName ?? part.name ?? item.name ?? "",
            estimate_sparepart_id: Number(row.id ?? part.id) || item.estimate_sparepart_id || null,
            estimate_sparepart_sequence: Number(row.sequence ?? part.sequence) || index + 1,
            sku: row.part_number ?? row.partNumber ?? row.sku ?? "",
            sell_price: Number.isFinite(sell) && sell >= 0 ? sell : item.sell_price,
            insurance_discount: discountPercent,
            net_sell_price: netSell,
            margin
        };
    });

    const changed = JSON.stringify(oldItems) !== JSON.stringify(nextItems);
    po.items = nextItems;
    if (changed) {
        po.updated_at = new Date().toISOString();
        await psSavePO();
    }
}

async function printPO(woId) {
    const po = psPO(woId);
    if (!po) { myWorkshopAlert("Purchase Order belum dibuat."); return; }

    // Gunakan data kendaraan terbaru dari WO terlebih dahulu.
    let poWO = psWOData.find(w => psWOId(w) === String(woId)) || null;
    

    if (!poWO) {
        try {
            const response = await fetch("/api/wo", { headers: { "Content-Type": "application/json" } });
            if (response.ok) {
                const result = await response.json();
                const apiWO = Array.isArray(result.data) ? result.data : [];
                poWO = apiWO.find(w => psWOId(w) === String(woId)) || null;
            }
        } catch (e) {
            console.warn("Gagal mengambil WO terbaru untuk cetak PO.", e);
        }
    }

    // Estimasi -> PO: setiap cetak PO mengambil Harga Jual, Diskon Asuransi (%),
    // dan SKU/No. Part dari sparepart BENGKEL yang sama berdasarkan ID.
    if (poWO) {
        await psRefreshPOFromEstimate(poWO, po);
    }

    const poBrand = po.brand && po.brand !== "-" ? po.brand : psBrand(poWO || {});
    const poModel = po.model && po.model !== "-" ? po.model : psModel(poWO || {});
    const poYear = po.year && po.year !== "-" ? po.year : psYear(poWO || {});
    const poVIN = po.vin_number && po.vin_number !== "-" ? po.vin_number : psVIN(poWO || {});
    const poInsurer = po.insurer_name && po.insurer_name !== "-" ? po.insurer_name : psInsurer(poWO || {});

    // Simpan snapshot kendaraan dan identitas asuransi agar PO lama tetap lengkap pada cetakan berikutnya.
    if (poBrand !== "-" || poModel !== "-" || poYear !== "-" || poVIN !== "-" || po.insurer_name !== poInsurer) {
        po.brand = poBrand;
        po.model = poModel;
        po.year = poYear;
        po.vin_number = poVIN;
        po.insurer_name = poInsurer;
        po.updated_at = new Date().toISOString();
        await psSavePO();
    }

    const allItems = (Array.isArray(po.items) ? po.items : []).filter(item => !psIsReturned(item));
    const vendorGroups = [];
    const groupMap = new Map();

    allItems.forEach(item => {
        const vendor = String(item?.vendor || "Stok Gudang").trim() || "Stok Gudang";
        const key = vendor.toUpperCase();
        if (!groupMap.has(key)) {
            const group = { vendor, items: [] };
            groupMap.set(key, group);
            vendorGroups.push(group);
        }
        groupMap.get(key).items.push(item);
    });

    if (!vendorGroups.length) {
        myWorkshopAlert("Tidak ada item Purchase Order untuk dicetak.");
        return;
    }

    // Satu nomor PO induk tetap dipertahankan, lalu setiap vendor mendapat nomor PO turunan.
    po.vendor_po_numbers = po.vendor_po_numbers && typeof po.vendor_po_numbers === "object"
        ? po.vendor_po_numbers
        : {};
    let vendorNumberChanged = false;
    vendorGroups.forEach((group, index) => {
        const key = group.vendor.toUpperCase();
        if (!po.vendor_po_numbers[key]) {
            po.vendor_po_numbers[key] = `${po.po_number}-${String(index + 1).padStart(2, "0")}`;
            vendorNumberChanged = true;
        }
        group.poNumber = po.vendor_po_numbers[key];
    });
    if (vendorNumberChanged) {
        po.updated_at = new Date().toISOString();
        await psSavePO();
    }

    const makeRowsAndTotals = items => {
        let totalNetBuy = 0;
        let totalNetSell = 0;
        let totalMargin = 0;

        const rows = items.map((x, i) => {
            const qty = Number(x.quantity) || 0;
            const netBuy = Number(x.net_buy_price ?? x.buy_price) || 0;
            const sell = Number(x.sell_price) || 0;
            const insuranceDiscount = Number(x.insurance_discount ?? x.discount_insurance ?? 0) || 0;
            const netSell = Number(x.net_sell_price ?? (sell - sell * insuranceDiscount / 100)) || 0;
            const margin = Number(x.margin ?? (netSell - netBuy)) || 0;
            totalNetBuy += netBuy * qty;
            totalNetSell += netSell * qty;
            totalMargin += margin * qty;
            return `<tr><td>${i + 1}</td><td>${psEscape(x.name)}</td><td>${psEscape(x.sku)}</td><td>${psEscape(x.quantity)}</td><td class="money">Rp ${psMoney(x.price_list)}</td><td class="money">${psMoney(x.discount)}%</td><td class="money">Rp ${psMoney(netBuy)}</td><td class="money">Rp ${psMoney(netSell)}</td><td class="money">Rp ${psMoney(margin)}</td></tr>`;
        }).join("");

        return { rows, totalNetBuy, totalNetSell, totalMargin };
    };

    const workshopHeader = await getWorkshopPrintHeader();

    const pages = vendorGroups.map((group, groupIndex) => {
        const calc = makeRowsAndTotals(group.items);
        return `<section class="po-page${groupIndex > 0 ? " page-break" : ""}">
${workshopHeader}
<h1>PURCHASE ORDER</h1>
<div class="vendor-title">Vendor: ${psEscape(group.vendor)}</div>
<div class="info">
<div><strong>No. PO:</strong> ${psEscape(group.poNumber)}</div>
<div><strong>Tanggal:</strong> ${psDate(po.created_at)}</div>
<div><strong>No. WO:</strong> ${psEscape(po.wo_number)}</div>
<div><strong>No. Estimasi:</strong> ${psEscape(po.estimate_number)}</div>
<div><strong>Customer:</strong> ${psEscape(po.customer_name)}</div>
<div><strong>Asuransi:</strong> ${psEscape(poInsurer)}</div>
<div><strong>No. Polisi:</strong> ${psEscape(po.plate_number)}</div>
<div><strong>Merek Mobil:</strong> ${psEscape(poBrand)}</div>
<div><strong>Type Mobil:</strong> ${psEscape(poModel)}</div>
<div><strong>Tahun Mobil:</strong> ${psEscape(poYear)}</div>
<div><strong>No. Rangka:</strong> ${psEscape(poVIN)}</div>
</div>
<table class="po-table"><colgroup><col class="no"><col class="name"><col class="sku"><col class="qty"><col class="price"><col class="discount"><col class="net"><col class="sell"><col class="margin"></colgroup>
<thead><tr><th>No</th><th>Nama Sparepart</th><th>SKU / No. Part</th><th>Qty</th><th>Harga Price List</th><th>Diskon (%)</th><th>Netto Harga Beli</th><th>Netto Harga Jual</th><th>Margin</th></tr></thead>
<tbody>${calc.rows}</tbody>
<tfoot><tr><th colspan="6" style="text-align:right">JUMLAH</th><th style="text-align:right">Rp ${psMoney(calc.totalNetBuy)}</th><th style="text-align:right">Rp ${psMoney(calc.totalNetSell)}</th><th style="text-align:right">Rp ${psMoney(calc.totalMargin)}</th></tr></tfoot>
</table>
<div class="sign"><div>Purchasing<br><br><br><br>________________________</div><div>Service Advisor<br><br><br><br>________________________</div><div>Approval<br><br><br><br>________________________</div></div>
</section>`;
    }).join("");

    const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>MyWorkshop</title><style>
@page{size:A4;margin:18mm !important}
html,body{margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#111}
.po-page{min-height:100%;box-sizing:border-box}.page-break{break-before:page;page-break-before:always}
h1{font-size:20px;margin:0 0 4px}.muted{color:#666;font-size:10px}.vendor-title{font-size:15px;font-weight:700;margin-top:12px}
.info{display:grid;grid-template-columns:1fr 1fr;column-gap:32px;row-gap:6px;margin:18px 0}.info div{margin:0}
.po-table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:12px;font-size:8.5px}.po-table th,.po-table td{border:1px solid #333;padding:4px 3px;vertical-align:middle;overflow:hidden}.po-table th{background:#f2f2f2;line-height:1.15}.po-table .money{white-space:nowrap !important;text-align:right;font-variant-numeric:tabular-nums;word-break:keep-all;overflow-wrap:normal;min-width:0}
.po-table col.no{width:4%}.po-table col.name{width:22%}.po-table col.sku{width:14%}.po-table col.qty{width:6%}.po-table col.price{width:14%}.po-table col.discount{width:8%}.po-table col.net{width:14%}.po-table col.sell{width:10%}.po-table col.margin{width:8%}
.sign{margin-top:55px;display:flex;justify-content:space-between;text-align:center}.sign div{width:40%}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.po-table{font-size:8.5px}.po-table th,.po-table td{padding:4px 3px}}
</style></head><body>${pages}<script>window.onload=()=>setTimeout(()=>window.print(),150)<\/script></body></html>`;
    const win = window.open("", "_blank");
    if (!win) { myWorkshopAlert("Popup diblokir browser. Izinkan popup untuk mencetak PO."); return; }
    // Catat bahwa aksi Print PO benar-benar sudah dijalankan.
    po.printed_at = new Date().toISOString();
    po.updated_at = new Date().toISOString();
    await psSavePO();
    renderPSList();

    win.document.write(html); win.document.close();
}

function psArrivalSummary(woId, parts) {
    const po = psPO(woId);
    const items = Array.isArray(po?.items) ? po.items : [];
    let arrived = 0, returned = 0;
    parts.forEach((item, index) => {
        const x = psFindPOItem(po, item, index) || {};
        if (psIsReturned(x)) { returned++; return; }
        if (x.arrival_date || x.arrived) arrived++;
    });
    return { arrived, returned, total: parts.length, remaining: Math.max(parts.length - arrived, 0) };
}

function psRefreshArrivalRow(index) {
    const check = document.querySelector(`#psArrivalParts .ps-arrival-check[data-index="${index}"]`);
    const row = check?.closest('.ps-arrival-item');
    if (!check || !row) return;
    row.classList.toggle('done', check.checked);
    const status = row.querySelector('.ps-arrival-state');
    if (status) status.textContent = check.checked ? 'SUDAH DATANG' : 'BELUM DATANG';
}

function openArrival(woId) {
    const po = psPO(woId);
    if (!po) { myWorkshopAlert("Buat Purchase Order terlebih dahulu."); return; }
    psCurrentWO = psWOData.find(w => psWOId(w) === String(woId));
    if (!psCurrentWO) { myWorkshopAlert("WO tidak ditemukan."); return; }

    const parts = psBengkelParts(psCurrentWO);
    const summary = psArrivalSummary(woId, parts);

    const info = psEl("psArrivalPartInfo");
    if (info) info.innerHTML = `<div class="ps-info ps-arrival-info">
        <div class="ps-info-item"><div class="ps-info-label">No. WO</div><div class="ps-info-value">${psEscape(psWONumber(psCurrentWO))}</div></div>
        <div class="ps-info-item"><div class="ps-info-label">No. Estimasi</div><div class="ps-info-value">${psEscape(psEstimate(psCurrentWO))}</div></div>
        <div class="ps-info-item"><div class="ps-info-label">Customer</div><div class="ps-info-value">${psEscape(psCustomer(psCurrentWO))}</div></div>
        <div class="ps-info-item"><div class="ps-info-label">No. Polisi</div><div class="ps-info-value">${psEscape(psPlate(psCurrentWO))}</div></div>
    </div>`;

    psEl("psArrivalParts").innerHTML = parts.map((item, index) => {
        const existing = psFindPOItem(po, item, index) || {};
        const arrived = !!(existing.arrival_date || existing.arrived) && !psIsReturned(existing);
        const returned = psIsReturned(existing);
        const name = item.part_name ?? item.partName ?? item.name ?? "-";
        const sku = item.part_number ?? item.partNumber ?? item.sku ?? existing.sku ?? "-";
        const qty = item.quantity ?? item.qty ?? 1;
        const date = existing.arrival_date || "";
        const note = existing.arrival_note || "";
        const photoCycle = 1 + (Array.isArray(existing.return_history) ? existing.return_history.length : 0);
        const photoKey = `bengkel:${psWOId(psCurrentWO)}:${item?.id ?? item?.sequence ?? index}:cycle${photoCycle}`;
        return `<div class="ps-arrival-item ${arrived ? "done" : ""} ${returned ? "returned" : ""}">
            <div style="grid-column:1/-1;margin:4px 0"><button type="button" class="btn-secondary btn-small" onclick="MyWorkshopReceiptPhotos.open('${psEscape(photoKey)}','Foto ${psEscape(name)}')">📷 Foto Sparepart</button></div>
            <div class="ps-arrival-check-cell">
                <input type="checkbox" class="ps-arrival-check" data-index="${index}" ${arrived ? "checked" : ""} onchange="psRefreshArrivalRow(${index})" aria-label="Sparepart sudah datang">
            </div>
            <div class="ps-arrival-part-cell">
                <strong>${psEscape(name)}</strong>
                <small>SKU / No. Part: ${psEscape(sku)} · Qty: ${psEscape(qty)}</small>
            </div>
            <div class="ps-arrival-date-cell"><label>Tanggal Kedatangan</label><input type="date" class="ps-arrival-date" data-index="${index}" value="${psEscape(date)}"></div>
            <div class="ps-arrival-note-cell"><label>Keterangan Sparepart</label><input type="text" class="ps-arrival-note" data-index="${index}" value="${psEscape(note)}" maxlength="500" placeholder="Keterangan sparepart"></div>
            <div class="ps-arrival-status-cell"><span class="ps-arrival-state">${returned ? "RETURN — SIAP DIGANTI" : (arrived ? "SUDAH DATANG" : "BELUM DATANG")}</span></div>
        </div>`;
    }).join("");

    psEl("psArrivalStatus").textContent = summary.remaining === 0
        ? "KOMPLIT — semua sparepart sudah datang."
        : `BELUM KOMPLIT — ${summary.remaining} dari ${summary.total} sparepart belum datang.`;
    psEl("psArrivalModal").classList.add("show");
}

function closePSArrival() {
    psEl("psArrivalModal")?.classList.remove("show");
    psCurrentWO = null;
}

async function saveArrival(event) {
    event.preventDefault();
    if (!psCurrentWO) return;
    const po = psPO(psWOId(psCurrentWO));
    if (!po) return;

    const checks = [...document.querySelectorAll("#psArrivalParts .ps-arrival-check")];
    const selected = checks.filter(x => x.checked);
    if (!selected.length) { myWorkshopAlert("Pilih minimal satu sparepart yang sudah datang."); return; }

    for (const check of selected) {
        const index = Number(check.dataset.index);
        if (!document.querySelector(`#psArrivalParts .ps-arrival-date[data-index="${index}"]`)?.value) {
            myWorkshopAlert("Tanggal kedatangan wajib diisi untuk setiap sparepart yang dicentang.");
            return;
        }
    }

    const parts = psBengkelParts(psCurrentWO);
    // Normalisasi urutan item PO mengikuti identitas sparepart BENGKEL.
    // Dengan demikian penyimpanan kedatangan/RETURN tidak pernah bergeser
    // dari sparepart yang sedang diedit.
    po.items = parts.map((item, index) => psFindPOItem(po, item, index) || {
        name: item.part_name ?? item.partName ?? item.name ?? "",
        estimate_sparepart_id: Number(item?.id) || null,
        estimate_sparepart_sequence: Number(item?.sequence) || index + 1,
        sku: item.part_number ?? item.partNumber ?? item.sku ?? "",
        quantity: Math.max(1, Number(item.quantity ?? item.qty ?? 1) || 1)
    });
    for (const check of checks.filter(x => x.checked)) {
        const index = Number(check.dataset.index), item = parts[index], entry = po.items[index] || {};
        const photoCycle = 1 + (Array.isArray(entry.return_history) ? entry.return_history.length : 0);
        const photoKey = `bengkel:${psWOId(psCurrentWO)}:${item?.id ?? item?.sequence ?? index}:cycle${photoCycle}`;
        if (await MyWorkshopReceiptPhotos.count(photoKey) < 1) { myWorkshopAlert(`Foto wajib diisi sebelum ${item?.part_name ?? item?.name ?? 'sparepart'} dinyatakan datang.`); return; }
    }
    checks.forEach(check => {
        const index = Number(check.dataset.index);
        const item = parts[index];
        if (!item) return;
        const entry = po.items[index];
        if (!check.checked) {
            if (!psIsReturned(entry)) {
                delete entry.arrival_date; delete entry.arrival_note; delete entry.arrived; delete entry.arrival_at;
            }
            po.items[index] = entry;
            return;
        }
        const date = document.querySelector(`#psArrivalParts .ps-arrival-date[data-index="${index}"]`)?.value || "";
        const note = document.querySelector(`#psArrivalParts .ps-arrival-note[data-index="${index}"]`)?.value.trim() || "";
        const wasReturned = psIsReturned(entry);
        const photoCycle = 1 + (Array.isArray(entry.return_history) ? entry.return_history.length : 0);
        const photoKey = `bengkel:${psWOId(psCurrentWO)}:${item?.id ?? item?.sequence ?? index}:cycle${photoCycle}`;
        if (wasReturned) {
            entry.replacement_history = Array.isArray(entry.replacement_history) ? entry.replacement_history : [];
            entry.replacement_history.push({ date, note, recorded_at: new Date().toISOString() });
        }
        entry.returned = false;
        entry.return_reason = "";
        entry.arrival_date = date; entry.arrival_note = note; entry.arrived = true; entry.arrival_at = new Date().toISOString(); entry.photo_key = photoKey;
        entry.name = entry.name || (item.part_name ?? item.partName ?? item.name ?? "");
        entry.quantity = entry.quantity ?? (item.quantity ?? item.qty ?? 1);
        po.items[index] = entry;
    });

    const summary = psArrivalSummary(psWOId(psCurrentWO), parts);
    po.arrival_date = summary.remaining === 0 ? new Date().toISOString().slice(0,10) : "";
    po.arrival_note = ""; po.updated_at = new Date().toISOString();
    await psSavePO(); closePSArrival(); renderPSList();
    const successMessage = summary.remaining === 0
        ? "Kedatangan berhasil disimpan. KOMPLIT — semua sparepart sudah datang."
        : `Kedatangan berhasil disimpan. ${summary.remaining} dari ${summary.total} sparepart belum datang.`;
    if (window.MyWorkshopReceiptPhotos?.success) MyWorkshopReceiptPhotos.success(successMessage);
    else myWorkshopAlert(successMessage, "success");
}

async function openPSReturn(index) {
    if (!psCurrentWO) return;
    const po = psPO(psWOId(psCurrentWO));
    const item = po?.items?.[index];
    if (!item || !item.arrival_date || psIsReturned(item)) {
        myWorkshopAlert("Sparepart ini belum berstatus SUDAH DATANG atau sudah RETURN.");
        return;
    }
    const name = item.name || psBengkelParts(psCurrentWO)[index]?.part_name || "Sparepart";
    const cleanReason = await psAskReturnReason(name);
    if (cleanReason === null) return;
    item.returned = true;
    item.return_reason = cleanReason;
    item.return_history = Array.isArray(item.return_history) ? item.return_history : [];
    item.return_history.push({ reason: cleanReason, returned_at: new Date().toISOString(), arrival_date: item.arrival_date || null, arrival_note: item.arrival_note || "" });
    delete item.arrival_date;
    delete item.arrival_note;
    delete item.arrived;
    delete item.arrival_at;
    po.arrival_date = "";
    po.updated_at = new Date().toISOString();
    try {
        await psSavePO();
        renderPSList();
        openPSDetail(psWOId(psCurrentWO));
        myWorkshopAlert(`Sparepart ${name} berhasil di-RETURN. Alasan: ${cleanReason}`, "success");
    } catch (e) {
        console.error("Gagal menyimpan RETURN sparepart:", e);
        myWorkshopAlert(`RETURN gagal disimpan.\n${e?.message || e}`);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    psEl("searchPermintaanSparepart")?.addEventListener("input", renderPSList);
    psEl("filterPOPermintaanSparepart")?.addEventListener("change", renderPSList);
    psLoad();
});
window.openPSDetail = openPSDetail;
window.closePSDetail = closePSDetail;
window.createPurchaseOrder = createPurchaseOrder;
window.togglePSVendorOther = togglePSVendorOther;
window.printPO = printPO;
window.openArrival = openArrival;
window.closePSArrival = closePSArrival;
window.saveArrival = saveArrival;
window.openPSReturn = openPSReturn;

window.openPSDetail = openPSDetail;
window.closePSDetail = closePSDetail;
window.createPurchaseOrder = createPurchaseOrder;
window.togglePSVendorOther = togglePSVendorOther;
window.printPO = printPO;
window.openArrival = openArrival;
window.closePSArrival = closePSArrival;
window.saveArrival = saveArrival;


// Warna tulisan khusus tombol Penerimaan Pengganti.
(function ensureReplacementArrivalButtonStyle(){
    if (document.getElementById("replacementArrivalButtonStyle")) return;
    const style = document.createElement("style");
    style.id = "replacementArrivalButtonStyle";
    style.textContent = `.replacement-arrival-btn { color: #000 !important; font-weight: 700 !important; }`;
    document.head.appendChild(style);
})();

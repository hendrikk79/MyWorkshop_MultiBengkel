
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
// MYWORKSHOP - PENERIMAAN SPAREPART SUPPLY
// Sumber WO sama dengan modul WO/Permintaan Sparepart.
// Hanya sparepart SUPPLY yang ditampilkan.
// Data penerimaan disimpan terpisah dan tidak mengubah Estimasi/WO.
// ============================================================

const SUPPLY_WO_KEY = myWorkshopScopedStorageKey("myworkshop_wo");
const SUPPLY_ARRIVAL_KEY = myWorkshopScopedStorageKey("myworkshop_supply_arrivals");

let supplyWOData = [];
let supplyArrivalData = [];
let supplyCurrentWO = null;
let supplyCurrentIndex = null;
// WO yang Tagihan Kuitansinya sudah dibuat. Digunakan agar WO Supply yang sudah KOMPLIT
// tetap tampil sampai Tagihan Kuitansi benar-benar dibuat.
let supplyKuitansiWOIds = new Set();

function supplyEl(id) { return document.getElementById(id); }

function supplyEscape(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function supplyAskReturnReason(partName) {
    return new Promise(resolve => {
        const existing = document.getElementById("supplyReturnReasonModal");
        if (existing) existing.remove();

        const modal = document.createElement("div");
        modal.id = "supplyReturnReasonModal";
        modal.innerHTML = `
            <div class="supply-return-modal-backdrop">
                <div class="supply-return-modal" role="dialog" aria-modal="true" aria-labelledby="supplyReturnReasonTitle">
                    <div class="supply-return-modal-header">
                        <h3 id="supplyReturnReasonTitle">Alasan RETURN Sparepart</h3>
                        <button type="button" class="supply-return-modal-close" aria-label="Tutup">&times;</button>
                    </div>
                    <div class="supply-return-modal-body">
                        <div class="supply-return-modal-part">${supplyEscape(partName || "Sparepart")}</div>
                        <label for="supplyReturnReasonInput">Alasan RETURN <span>*</span></label>
                        <textarea id="supplyReturnReasonInput" rows="4" placeholder="Masukkan alasan RETURN..."></textarea>
                    </div>
                    <div class="supply-return-modal-footer">
                        <button type="button" class="btn-secondary supply-return-cancel">Batal</button>
                        <button type="button" class="btn-primary supply-return-save">Simpan RETURN</button>
                    </div>
                </div>
            </div>`;

        const styleId = "supplyReturnReasonModalStyle";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
                #supplyReturnReasonModal{position:fixed;inset:0;z-index:10000;}
                .supply-return-modal-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:20px;}
                .supply-return-modal{width:min(520px,100%);background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden;}
                .supply-return-modal-header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #e5e7eb;}
                .supply-return-modal-header h3{margin:0;font-size:17px;}
                .supply-return-modal-close{border:0;background:transparent;font-size:25px;line-height:1;cursor:pointer;color:#64748b;}
                .supply-return-modal-body{padding:18px;}
                .supply-return-modal-part{font-weight:600;margin-bottom:14px;}
                .supply-return-modal-body label{display:block;font-weight:600;margin-bottom:7px;}
                .supply-return-modal-body label span{color:#dc2626;}
                .supply-return-modal-body textarea{width:100%;min-height:100px;resize:vertical;padding:10px;border:1px solid #cbd5e1;border-radius:7px;font:inherit;box-sizing:border-box;}
                .supply-return-modal-body textarea:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.12);}
                .supply-return-modal-footer{display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid #e5e7eb;}
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(modal);
        const input = modal.querySelector("#supplyReturnReasonInput");
        const close = value => { modal.remove(); resolve(value); };
        modal.querySelector(".supply-return-modal-close").addEventListener("click", () => close(null));
        modal.querySelector(".supply-return-cancel").addEventListener("click", () => close(null));
        modal.querySelector(".supply-return-modal-backdrop").addEventListener("click", e => {
            if (e.target === e.currentTarget) close(null);
        });
        modal.querySelector(".supply-return-save").addEventListener("click", () => {
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

function supplyLoadJSON(key, fallback = []) {
    try {
        const raw = localStorage.getItem(key);
        const value = raw ? JSON.parse(raw) : fallback;
        return Array.isArray(value) ? value : fallback;
    } catch (e) {
        console.error("Gagal membaca", key, e);
        return fallback;
    }
}

async function supplySaveArrivals() {
    const u = (() => {
        try {
            return JSON.parse(localStorage.getItem("myworkshop_user") || "null") || {};
        } catch (_) {
            return {};
        }
    })();
    const userId = Number(u.id || u.user_id || 0) || null;

    // Simpan langsung ke Central Storage API. Jangan bergantung pada app.js
    // karena layout.js memuat app.js secara dinamis dan dapat menimbulkan race
    // saat halaman ini melakukan save/load.
    const response = await fetch("/api/storage/supply_arrivals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
            data: supplyArrivalData,
            updated_by: userId
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.success === false) {
        throw new Error(result?.message || `HTTP ${response.status}`);
    }
    return result?.data;
}

function supplyStatus(wo) {
    return String(wo?.status || "CHECK IN").trim().toUpperCase();
}

function supplyActiveWO(wo) {
    return supplyStatus(wo) !== "CHECK OUT";
}

function supplyType(item) {
    return String(
        item?.supply_bengkel ??
        item?.supplyBengkel ??
        item?.supply ??
        "BENGKEL"
    ).trim().toUpperCase();
}

function supplyParts(wo) {
    const arr = wo?.spareparts || wo?.sparepart || wo?.items_sparepart || [];
    return Array.isArray(arr) ? arr : [];
}

function supplyOnly(wo) {
    return supplyParts(wo).filter(item => supplyType(item) === "SUPPLY");
}

function supplyWOId(wo) {
    return String(wo?.id ?? wo?.wo_id ?? wo?.wo_number ?? "");
}

function supplyWONumber(wo) {
    return String(wo?.wo_number ?? wo?.woNumber ?? wo?.number ?? "-");
}

function supplyEstimate(wo) {
    return String(wo?.estimate_number ?? wo?.estimateNumber ?? wo?.noEstimasi ?? "-");
}

function supplyCustomer(wo) {
    return String(wo?.customer_name ?? wo?.customerName ?? wo?.customer ?? "-");
}

function supplyPlate(wo) {
    return String(wo?.plate_number ?? wo?.plateNumber ?? wo?.plate ?? "-");
}

function supplyInsurer(wo) {
    // Tampilkan NAMA ALIAS Asuransi saja. Jangan pernah menampilkan insurer_id.
    const alias = wo?.insurer_alias ?? wo?.insurerAlias ?? wo?.asuransi_alias ?? wo?.insurance_alias ?? wo?.alias_asuransi;
    return String(alias ?? "-").trim() || "-";
}

function supplyFrameNumber(wo) {
    const direct = wo?.vin ?? wo?.vin_number ?? wo?.vinNumber ?? wo?.chassis_number ?? wo?.chassisNumber ?? wo?.no_rangka ?? wo?.noRangka ?? wo?.frame_number ?? wo?.frameNumber;
    return direct ? String(direct) : "-";
}

function supplyPartName(item) {
    return String(item?.part_name ?? item?.partName ?? item?.name ?? item?.nama ?? "-");
}

function supplySKU(item) {
    return String(item?.part_number ?? item?.partNumber ?? item?.sku ?? item?.kode ?? "");
}

function supplyQty(item) {
    return item?.quantity ?? item?.qty ?? 0;
}

function supplyDate(value) {
    if (!value) return "-";
    const d = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function supplyIsReturned(record) {
    return !!(record?.returned || record?.return_status === "RETURN" || record?.status === "RETURN");
}

function supplyReturnReason(record) {
    const history = Array.isArray(record?.return_history) ? record.return_history : [];
    const latest = history.length ? history[history.length - 1] : null;
    return String(record?.return_reason ?? latest?.reason ?? "").trim();
}


function supplyArrival(woId, itemIndex, itemId = null) {
    const sameWO = record =>
        String(record?.wo_id ?? record?.woId ?? "") === String(woId);

    // Prioritaskan ID sparepart agar penerimaan tetap melekat pada item yang
    // sama walaupun urutan sparepart di WO berubah.
    if (itemId !== null && itemId !== undefined && String(itemId) !== "") {
        const byItemId = supplyArrivalData.find(record =>
            sameWO(record) &&
            String(record?.item_id ?? record?.itemId ?? "") === String(itemId)
        );
        if (byItemId && !supplyIsReturned(byItemId)) return byItemId;
    }

    // Fallback untuk data penerimaan lama yang masih menggunakan item_index.
    return supplyArrivalData.find(record =>
        sameWO(record) &&
        Number(record?.item_index ?? record?.itemIndex) === Number(itemIndex) &&
        !supplyIsReturned(record)
    ) || null;
}

async function supplyLoad() {
    // Gunakan snapshot database pusat yang sama dengan Permintaan Sparepart.
    // Tidak ada perbedaan sumber data berdasarkan role.
    supplyWOData = [];
    supplyArrivalData = [];
    supplyKuitansiWOIds = new Set();
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

        supplyWOData = Array.isArray(result.data) ? result.data : [];
        supplyArrivalData = Array.isArray(result.supply_arrivals) ? result.supply_arrivals : [];

        const rows = Array.isArray(result.kuitansi) ? result.kuitansi : [];
        rows.forEach(row => {
            const kuitansiId = row?.kuitansi_id ?? row?.id ?? null;
            const woId = row?.wo_id ?? row?.woId ?? null;
            if (kuitansiId !== null && kuitansiId !== undefined && kuitansiId !== "" &&
                woId !== null && woId !== undefined && woId !== "") {
                supplyKuitansiWOIds.add(String(woId));
            }
        });

        if (supplyArrivalData.length) {
            localStorage.setItem(SUPPLY_ARRIVAL_KEY, JSON.stringify(supplyArrivalData));
        }
    } catch (e) {
        console.error("Gagal mengambil snapshot Sparepart dari database pusat:", e);
        supplyWOData = [];
        supplyArrivalData = [];
        supplyKuitansiWOIds = new Set();
    }

    renderSupplyList();
}

function renderSupplyList() {
    const body = supplyEl("supplyWOBody");
    if (!body) return;

    // WO aktif maupun CHECK OUT tetap ditampilkan selama masih ada sparepart
    // SUPPLY yang BELUM DATANG. WO hilang dari daftar hanya jika seluruh
    // sparepart SUPPLY-nya sudah diterima.
    const keyword = String(supplyEl("searchPenerimaanSupply")?.value || "").trim().toLowerCase();
    const completionFilter = String(supplyEl("filterKomplitPenerimaanSupply")?.value || "SEMUA").trim().toUpperCase();
    const rows = supplyWOData
        .filter(wo => supplyOnly(wo).length)
        .filter(wo => {
            const summary = supplyArrivalSummary(supplyWOId(wo), wo);
            if (completionFilter === "KOMPLIT") return summary.remaining === 0;
            if (completionFilter === "BELUM_KOMPLIT") return summary.remaining > 0;
            return true;
        })
        .filter(wo => {
            const text = [
                supplyWONumber(wo),
                supplyEstimate(wo),
                supplyCustomer(wo),
                supplyPlate(wo)
            ].join(" ").toLowerCase();
            return !keyword || text.includes(keyword);
        })
        .filter(wo => {
            const summary = supplyArrivalSummary(supplyWOId(wo), wo);
            // Tetap tampil jika masih ada sparepart yang belum datang.
            if (summary.remaining > 0) return true;

            // Jika sparepart SUPPLY sudah KOMPLIT, WO baru boleh hilang setelah
            // Tagihan Kuitansi sudah dibuat.
            return !supplyKuitansiWOIds.has(String(supplyWOId(wo)));
        });

    if (!rows.length) {
        body.innerHTML = `
            <tr>
                <td colspan="9" class="supply-empty">
                    Belum ada WO dengan sparepart SUPPLY yang masih belum diterima.
                </td>
            </tr>`;
        return;
    }

    body.innerHTML = rows.map((wo, index) => {
        const parts = supplyOnly(wo);
        const arrived = parts.filter((part) => {
            const originalIndex = supplyParts(wo).indexOf(part);
            return !!supplyArrival(supplyWOId(wo), originalIndex, part?.id);
        }).length;

        const remaining = parts.length - arrived;
        const status = remaining === 0
            ? `<span class="supply-badge done">KOMPLIT</span>`
            : `<span class="supply-badge">BELUM KOMPLIT — ${remaining} dari ${parts.length} BELUM DATANG</span>`;

        return `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${supplyEscape(supplyWONumber(wo))}</strong></td>
                <td>${supplyEscape(supplyEstimate(wo))}</td>
                <td>${supplyEscape(supplyCustomer(wo))}</td>
                <td>${supplyEscape(supplyPlate(wo))}</td>
                <td>${supplyEscape(supplyInsurer(wo))}</td>
                <td>${parts.length}</td>
                <td>${status}</td>
                <td>
                    <div class="supply-actions">
                        <button
                            type="button"
                            class="btn-secondary btn-small supply-link-btn"
                            onclick="openSupplyDetail('${supplyEscape(supplyWOId(wo))}')">
                            Detail
                        </button>
                    </div>
                </td>
            </tr>`;
    }).join("");
}

function openSupplyDetail(id) {
    supplyCurrentWO = supplyWOData.find(
        w => supplyWOId(w) === String(id)
    );

    if (!supplyCurrentWO) {
        myWorkshopAlert("WO tidak ditemukan.");
        return;
    }

    const parts = supplyParts(supplyCurrentWO)
        .map((item, originalIndex) => ({ item, originalIndex }))
        .filter(x => supplyType(x.item) === "SUPPLY");

    supplyEl("supplyDetailTitle").textContent =
        `Detail Penerimaan Sparepart Supply - ${supplyWONumber(supplyCurrentWO)}`;

    supplyEl("supplyDetailInfo").innerHTML = `
        <div class="supply-info">
            <div class="supply-info-item">
                <div class="supply-info-label">No. WO</div>
                <div class="supply-info-value">${supplyEscape(supplyWONumber(supplyCurrentWO))}</div>
            </div>
            <div class="supply-info-item">
                <div class="supply-info-label">No. Estimasi</div>
                <div class="supply-info-value">${supplyEscape(supplyEstimate(supplyCurrentWO))}</div>
            </div>
            <div class="supply-info-item">
                <div class="supply-info-label">Customer</div>
                <div class="supply-info-value">${supplyEscape(supplyCustomer(supplyCurrentWO))}</div>
            </div>
            <div class="supply-info-item">
                <div class="supply-info-label">No. Polisi</div>
                <div class="supply-info-value">${supplyEscape(supplyPlate(supplyCurrentWO))}</div>
            </div>
            <div class="supply-info-item">
                <div class="supply-info-label">Asuransi</div>
                <div class="supply-info-value">${supplyEscape(supplyInsurer(supplyCurrentWO))}</div>
            </div>
            <div class="supply-info-item">
                <div class="supply-info-label">Asuransi</div>
                <div class="supply-info-value">${supplyEscape(supplyInsurer(supplyCurrentWO))}</div>
            </div>
            <div class="supply-info-item">
                <div class="supply-info-label">Merek Mobil</div>
                <div class="supply-info-value">${supplyEscape(supplyCurrentWO.brand ?? supplyCurrentWO.vehicle_brand ?? supplyCurrentWO.merk ?? supplyCurrentWO.make ?? "-")}</div>
            </div>
            <div class="supply-info-item">
                <div class="supply-info-label">Type Mobil</div>
                <div class="supply-info-value">${supplyEscape(supplyCurrentWO.model ?? supplyCurrentWO.vehicle_model ?? supplyCurrentWO.type ?? supplyCurrentWO.vehicle_type ?? "-")}</div>
            </div>
            <div class="supply-info-item">
                <div class="supply-info-label">No. Rangka</div>
                <div class="supply-info-value">${supplyEscape(supplyFrameNumber(supplyCurrentWO))}</div>
            </div>
        </div>`;

    supplyEl("supplyDetailBody").innerHTML = parts.map(({ item, originalIndex }, index) => {
        const record = supplyArrivalData.find(record =>
            String(record?.wo_id ?? record?.woId ?? "") === String(supplyWOId(supplyCurrentWO)) &&
            ((item?.id != null && String(record?.item_id ?? record?.itemId ?? "") === String(item.id)) ||
             Number(record?.item_index ?? record?.itemIndex) === Number(originalIndex))
        ) || null;
        const arrival = record && !supplyIsReturned(record) ? record : null;
        const returned = !!(record && supplyIsReturned(record));
        const returnReason = supplyReturnReason(record);
        const statusHtml = returned
            ? `<span class="supply-return-badge">RETURN</span><small class="supply-return-reason">${supplyEscape(returnReason || "Alasan belum tercatat")}</small>`
            : arrival
                ? `<span class="supply-badge done">DATANG</span>`
                : `<span class="supply-badge">BELUM DATANG</span>`;
        const actionHtml = returned
            ? `<button type="button" class="btn-primary btn-small replacement-arrival-btn" onclick="openSupplyArrival('${supplyEscape(supplyWOId(supplyCurrentWO))}')">Penerimaan Pengganti</button>`
            : arrival
                ? `<button type="button" class="btn-secondary btn-small" onclick="openSupplyReturn(${originalIndex})">RETURN</button>`
                : "";
        return `
            <tr>
                <td>${index + 1}</td>
                <td>${supplyEscape(supplyPartName(item))}</td>
                <td>${supplyEscape(supplySKU(item) || "-")}</td>
                <td>${supplyEscape(supplyQty(item))}</td>
                <td>${statusHtml}</td>
                <td>${arrival ? supplyEscape(supplyDate(arrival.arrival_date)) : record?.arrival_date ? supplyEscape(supplyDate(record.arrival_date)) : "-"}</td>
                <td>${arrival ? supplyEscape(arrival.supplier) : record?.supplier ? supplyEscape(record.supplier) : "-"}</td>
                <td>${arrival ? supplyEscape(arrival.note || "-") : returned ? supplyEscape(`RETURN: ${returnReason || "-"}`) : "-"}</td>
                <td>${actionHtml}</td>
            </tr>`;
    }).join("");

    supplyEl("supplyDetailModal").classList.add("show");
}

function closeSupplyDetail() {
    supplyEl("supplyDetailModal")?.classList.remove("show");
    supplyCurrentWO = null;
}

function supplyArrivalSummary(woId, wo) {
    const parts = supplyOnly(wo);
    let arrived = 0;
    parts.forEach(part => {
        const originalIndex = supplyParts(wo).indexOf(part);
        if (supplyArrival(woId, originalIndex, part?.id)) arrived++;
    });
    return { arrived, total: parts.length, remaining: Math.max(parts.length - arrived, 0) };
}

function openSupplyArrival(woId) {
    const wo = supplyCurrentWO || supplyWOData.find(w => supplyWOId(w) === String(woId) || supplyWONumber(w) === String(woId));
    if (!wo) { myWorkshopAlert("WO tidak ditemukan. Silakan buka kembali Detail WO."); return; }

    const parts = supplyOnly(wo);
    if (!parts.length) { myWorkshopAlert("Tidak ada sparepart Supply pada WO ini."); return; }

    supplyCurrentWO = wo;
    supplyCurrentIndex = null;
    const resolvedWoId = supplyWOId(wo);
    const summary = supplyArrivalSummary(resolvedWoId, wo);

    supplyEl("supplyArrivalPartInfo").innerHTML = `<div class="supply-info">
        <div class="supply-info-item"><div class="supply-info-label">WO</div><div class="supply-info-value">${supplyEscape(supplyWONumber(wo))}</div></div>
        <div class="supply-info-item"><div class="supply-info-label">Estimasi</div><div class="supply-info-value">${supplyEscape(supplyEstimate(wo))}</div></div>
        <div class="supply-info-item"><div class="supply-info-label">Customer</div><div class="supply-info-value">${supplyEscape(supplyCustomer(wo))}</div></div>
        <div class="supply-info-item"><div class="supply-info-label">No. Polisi</div><div class="supply-info-value">${supplyEscape(supplyPlate(wo))}</div></div>
        <div class="supply-info-item"><div class="supply-info-label">Asuransi</div><div class="supply-info-value">${supplyEscape(supplyInsurer(wo))}</div></div>
        <div class="supply-info-item"><div class="supply-info-label">Merek Mobil</div><div class="supply-info-value">${supplyEscape(wo.brand ?? wo.vehicle_brand ?? wo.merk ?? wo.make ?? "-")}</div></div>
        <div class="supply-info-item"><div class="supply-info-label">Type Mobil</div><div class="supply-info-value">${supplyEscape(wo.model ?? wo.vehicle_model ?? wo.type ?? wo.vehicle_type ?? "-")}</div></div>
        <div class="supply-info-item"><div class="supply-info-label">No. Rangka</div><div class="supply-info-value">${supplyEscape(supplyFrameNumber(wo))}</div></div>
    </div>`;

    const allParts = supplyParts(wo);
    supplyEl("supplyArrivalParts").innerHTML = allParts.map((item, originalIndex) => {
        if (supplyType(item) !== "SUPPLY") return "";
        const record = supplyArrivalData.find(record =>
            String(record?.wo_id ?? record?.woId ?? "") === String(supplyWOId(wo)) &&
            ((item?.id != null && String(record?.item_id ?? record?.itemId ?? "") === String(item.id)) ||
             Number(record?.item_index ?? record?.itemIndex) === Number(originalIndex))
        ) || null;
        const arrival = record && !supplyIsReturned(record) ? record : null;
        const returned = !!(record && supplyIsReturned(record));
        const arrived = !!arrival;
        const date = record?.arrival_date || "";
        const note = record?.note || "";
        const supplier = record?.supplier || "";
        const photoCycle = 1 + (Array.isArray(record?.return_history) ? record.return_history.length : 0);
        const photoKey = `supply:${supplyWOId(supplyCurrentWO)}:${item?.id ?? originalIndex}:cycle${photoCycle}`;
        return `<div class="supply-arrival-item ${arrived ? "done" : ""} ${returned ? "returned" : ""}">
            <div style="margin:4px 0"><button type="button" class="btn-secondary btn-small" onclick="MyWorkshopReceiptPhotos.open('${supplyEscape(photoKey)}','Foto ${supplyEscape(supplyPartName(item))}')">📷 Foto Sparepart</button></div>
            <label class="supply-arrival-check-row">
                <input type="checkbox" class="supply-arrival-check" data-index="${originalIndex}" ${arrived ? "checked" : ""}>
                <span class="supply-arrival-part-main">
                    <span class="supply-arrival-part-name">${supplyEscape(supplyPartName(item) || "-")}</span>
                    <span class="supply-arrival-part-meta">SKU / No. Part: ${supplyEscape(supplySKU(item) || "-")} &nbsp;•&nbsp; Qty: ${supplyEscape(supplyQty(item))}</span>
                    <span class="supply-arrival-state">${returned ? "RETURN — SIAP DIGANTI" : (arrived ? "SUDAH DATANG" : "BELUM DATANG")}</span>
                </span>
            </label>
            <div class="supply-arrival-fields">
                <div class="supply-arrival-field"><label>Tanggal Kedatangan</label><input type="date" class="supply-arrival-date" data-index="${originalIndex}" value="${supplyEscape(date)}"></div>
                <div class="supply-arrival-field"><label>Supplier Sparepart</label><input type="text" class="supply-arrival-supplier" data-index="${originalIndex}" value="${supplyEscape(supplier)}" maxlength="150" placeholder="Nama supplier"></div>
                <div class="supply-arrival-field note-field"><label>Keterangan Sparepart</label><input type="text" class="supply-arrival-note" data-index="${originalIndex}" value="${supplyEscape(note)}" maxlength="500" placeholder="Contoh: lengkap, sebagian, kondisi baik"></div>
            </div>
        </div>`;
    }).join("");

    supplyEl("supplyArrivalStatus").textContent = summary.remaining === 0
        ? "KOMPLIT — semua sparepart Supply sudah datang."
        : `BELUM KOMPLIT — ${summary.remaining} dari ${summary.total} sparepart belum datang.`;

    supplyEl("supplyArrivalModal").classList.add("show");
}

function closeSupplyArrival() {
    supplyEl("supplyArrivalModal")?.classList.remove("show");
    supplyCurrentWO = null;
    supplyCurrentIndex = null;
}

async function saveSupplyArrival(event) {
    event.preventDefault();
    if (!supplyCurrentWO) return;

    const checks = [...document.querySelectorAll("#supplyArrivalParts .supply-arrival-check")];
    const selected = checks.filter(x => x.checked);

    if (!selected.length) { myWorkshopAlert("Pilih minimal satu sparepart Supply yang sudah datang."); return; }

    const woId = supplyWOId(supplyCurrentWO);
    const allParts = supplyParts(supplyCurrentWO);

    for (const check of selected) {
        const index = Number(check.dataset.index);
        const date = document.querySelector(`#supplyArrivalParts .supply-arrival-date[data-index="${index}"]`)?.value || "";
        if (!date) {
            myWorkshopAlert("Tanggal kedatangan wajib diisi untuk setiap sparepart yang dicentang.");
            return;
        }
        const supplier = document.querySelector(`#supplyArrivalParts .supply-arrival-supplier[data-index="${index}"]`)?.value.trim() || "";
        if (!supplier) {
            myWorkshopAlert("Supplier wajib diisi untuk setiap sparepart yang dicentang.");
            return;
        }
    }

    for (const check of selected) {
        const index = Number(check.dataset.index), item = allParts[index];
        if (!item || supplyType(item) !== "SUPPLY") continue;
        const existing = supplyArrivalData.find(record => String(record?.wo_id ?? record?.woId ?? "") === String(woId) && ((item?.id != null && String(record?.item_id ?? record?.itemId ?? "") === String(item.id)) || Number(record?.item_index ?? record?.itemIndex) === Number(index))) || {};
        const cycle = 1 + (Array.isArray(existing.return_history) ? existing.return_history.length : 0);
        const key = `supply:${woId}:${item?.id ?? index}:cycle${cycle}`;
        if (await MyWorkshopReceiptPhotos.count(key) < 1) { myWorkshopAlert(`Foto wajib diisi sebelum ${supplyPartName(item)} dinyatakan datang.`); return; }
    }
    selected.forEach(check => {
        const index = Number(check.dataset.index);
        const item = allParts[index];
        if (!item || supplyType(item) !== "SUPPLY") return;

        const old = supplyArrivalData.find(record =>
            String(record?.wo_id ?? record?.woId ?? "") === String(woId) &&
            ((item?.id != null && String(record?.item_id ?? record?.itemId ?? "") === String(item.id)) ||
             Number(record?.item_index ?? record?.itemIndex) === Number(index))
        ) || null;
        const record = old || {
            id: `LOCAL-SUPPLY-${Date.now()}-${index}`,
            wo_id: woId,
            item_index: index,
            item_id: item?.id ?? null,
            created_at: new Date().toISOString()
        };

        const date = document.querySelector(`#supplyArrivalParts .supply-arrival-date[data-index="${index}"]`)?.value || "";
        const note = document.querySelector(`#supplyArrivalParts .supply-arrival-note[data-index="${index}"]`)?.value.trim() || "";
        const supplier = document.querySelector(`#supplyArrivalParts .supply-arrival-supplier[data-index="${index}"]`)?.value.trim() || "";

        record.item_id = item?.id ?? record.item_id ?? null;
        record.item_index = index;
        record.wo_number = supplyWONumber(supplyCurrentWO);
        record.estimate_number = supplyEstimate(supplyCurrentWO);
        record.part_name = supplyPartName(item);
        record.sku = supplySKU(item);
        record.quantity = supplyQty(item);
        const photoCycle = 1 + (Array.isArray(record.return_history) ? record.return_history.length : 0);
        const photoKey = `supply:${woId}:${item?.id ?? index}:cycle${photoCycle}`;
        const wasReturned = supplyIsReturned(record);
        if (wasReturned) {
            record.replacement_history = Array.isArray(record.replacement_history) ? record.replacement_history : [];
            record.replacement_history.push({ arrival_date: date, supplier, note, recorded_at: new Date().toISOString() });
        }
        record.returned = false;
        record.return_reason = "";
        record.arrival_date = date;
        record.photo_key = photoKey;
        record.supplier = supplier;
        record.note = note;
        record.updated_at = new Date().toISOString();

        if (!old) supplyArrivalData.unshift(record);
    });

    try {
        await supplySaveArrivals();
    } catch (error) {
        console.error("Gagal menyimpan penerimaan Sparepart Supply:", error);
        myWorkshopAlert(`Penerimaan gagal disimpan ke database pusat.\n${error.message}`);
        return;
    }
    const reopenId = woId;
    const summary = supplyArrivalSummary(woId, supplyCurrentWO);
    closeSupplyArrival();
    renderSupplyList();
    openSupplyDetail(reopenId);

    const successMessage = summary.remaining === 0
        ? "Penerimaan berhasil disimpan. KOMPLIT — semua sparepart Supply sudah datang."
        : `Penerimaan berhasil disimpan. ${summary.remaining} dari ${summary.total} sparepart belum datang.`;
    if (window.MyWorkshopReceiptPhotos?.success) MyWorkshopReceiptPhotos.success(successMessage);
    else myWorkshopAlert(successMessage, "success");
}

async function openSupplyReturn(itemIndex) {
    if (!supplyCurrentWO) return;
    const item = supplyParts(supplyCurrentWO)[Number(itemIndex)];
    if (!item || supplyType(item) !== "SUPPLY") { myWorkshopAlert("Sparepart Supply tidak ditemukan."); return; }
    const record = supplyArrivalData.find(record =>
        String(record?.wo_id ?? record?.woId ?? "") === String(supplyWOId(supplyCurrentWO)) &&
        ((item?.id != null && String(record?.item_id ?? record?.itemId ?? "") === String(item.id)) ||
         Number(record?.item_index ?? record?.itemIndex) === Number(itemIndex))
    ) || null;
    if (!record || supplyIsReturned(record) || !record.arrival_date) {
        myWorkshopAlert("Sparepart ini belum berstatus SUDAH DATANG atau sudah RETURN.");
        return;
    }
    const cleanReason = await supplyAskReturnReason(supplyPartName(item));
    if (cleanReason === null) return;
    record.returned = true;
    record.return_reason = cleanReason;
    record.return_history = Array.isArray(record.return_history) ? record.return_history : [];
    record.return_history.push({ reason: cleanReason, returned_at: new Date().toISOString(), arrival_date: record.arrival_date || null, supplier: record.supplier || "", note: record.note || "" });
    record.updated_at = new Date().toISOString();
    try {
        await supplySaveArrivals();
        renderSupplyList();
        openSupplyDetail(supplyWOId(supplyCurrentWO));
        myWorkshopAlert(`Sparepart ${supplyPartName(item)} berhasil di-RETURN. Alasan: ${cleanReason}`);
    } catch (e) {
        console.error("Gagal menyimpan RETURN Sparepart Supply:", e);
        myWorkshopAlert(`RETURN gagal disimpan.\n${e?.message || e}`);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    supplyEl("searchPenerimaanSupply")?.addEventListener("input", renderSupplyList);
    supplyEl("filterKomplitPenerimaanSupply")?.addEventListener("change", renderSupplyList);
    supplyLoad();
});
window.openSupplyDetail = openSupplyDetail;
window.closeSupplyDetail = closeSupplyDetail;
window.openSupplyArrival = openSupplyArrival;
window.closeSupplyArrival = closeSupplyArrival;
window.saveSupplyArrival = saveSupplyArrival;
window.openSupplyReturn = openSupplyReturn;


// Warna tulisan khusus tombol Penerimaan Pengganti.
(function ensureReplacementArrivalButtonStyle(){
    if (document.getElementById("replacementArrivalButtonStyle")) return;
    const style = document.createElement("style");
    style.id = "replacementArrivalButtonStyle";
    style.textContent = `.replacement-arrival-btn { color: #000 !important; font-weight: 700 !important; }`;
    document.head.appendChild(style);
})();
